"""Motore passivo PROFINET. Non trasmette pacchetti né si connette al PLC."""
import csv
import json
import queue
import struct
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Any, TypedDict, TextIO


class MachineState(TypedDict):
    impulsi: int
    pezzi: int
    last: float | None
    previous: float | None
    frames: int
    last_frame: float | None
    level: int | None
    hour: deque[float]
    invalid: int
    gap: bool


class FlowState(TypedDict):
    frames: int
    last_frame: float | None
    previous: bytes | None
    last_good_before: float | None


class BitState(TypedDict):
    transizioni: int
    salite: int
    last: float | None


class AuxState(TypedDict):
    sirena_attivazioni: int
    sirena_ultimo: float | None
    sirena_livello: int | None


def decode(raw):
    if len(raw) < 22:
        return None
    mac = ':'.join(f'{b:02x}' for b in raw[6:12])
    pos = 12
    et = struct.unpack_from('!H', raw, pos)[0]
    pos += 2
    while et in (0x8100, 0x88a8, 0x9100):
        if len(raw) < pos + 4:
            return None
        et = struct.unpack_from('!H', raw, pos + 2)[0]
        pos += 4
    if et != 0x8892 or len(raw) < pos + 6:
        return None
    fid = struct.unpack_from('!H', raw, pos)[0]
    pos += 2
    if not (0x8000 <= fid <= 0xbfff):
        return None
    # Last four bytes are CycleCounter, DataStatus and TransferStatus.
    return mac, fid, raw[pos:-4], raw[-2], raw[-1]


def stamp(ts):
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec='milliseconds')


class Reader:
    def __init__(self, cfg, folder):
        self.lock = threading.RLock()
        self.messages: queue.Queue[tuple[Any, ...]] = queue.Queue()
        self.machines = {m['codice']: m for m in cfg['macchine']}
        self.flows = {(f['mac'].lower(), int(f['frame_id'], 16)): f for f in cfg['flussi_et200sp']}
        self.by_signal = {}
        for m in cfg['macchine']:
            sig = m['segnale']
            if sig:
                self.by_signal[(sig['mac'].lower(), int(sig['frame_id'], 16))] = m
        self.aux_signals = {}
        for m in cfg['macchine']:
            for sig in m.get('segnali_stato', []):
                k = (sig['mac'].lower(), int(sig['frame_id'], 16), sig['byte'], sig['bit'])
                self.aux_signals[k] = (m['codice'], sig)
        self.aux_state: dict[str, AuxState] = {code: AuxState(sirena_attivazioni=0, sirena_ultimo=None, sirena_livello=None) for code in self.machines}
        self.machine_state: dict[str, MachineState] = {k: MachineState(impulsi=0, pezzi=0, last=None, previous=None, frames=0, last_frame=None, level=None, hour=deque(), invalid=0, gap=False) for k in self.machines}
        self.flow_state: dict[tuple[str, int], FlowState] = {key: FlowState(frames=0, last_frame=None, previous=None, last_good_before=None) for key in self.flows}
        self.bits: dict[tuple[str, int, int, int], BitState] = {}  # key: (MAC, FrameID, byte_offset, bit) => transitions/rises
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        self._files: list[TextIO] = []
        self.w_impulsi: Any = None
        self.w_transizioni: Any = None
        self.w_marcatori: Any = None
        self.w_attivazioni_sirena: Any = None
        for name, header in [
            ('impulsi.csv', ['timestamp_locale','macchina','mac','frame_id','byte_sdu','bit','impulso_sessione','pezzi_sessione','moltiplicatore']),
            ('transizioni.csv', ['timestamp_locale','mac','frame_id','byte_sdu','bit','prima','dopo']),
            ('marcatori.csv', ['timestamp_locale','macchina','nota']),
            ('attivazioni_sirena.csv', ['timestamp_locale','macchina','mac','frame_id','byte_sdu','bit','attivazione_sessione']),
        ]:
            p = folder / name
            fp = p.open('a', newline='', encoding='utf-8-sig', buffering=1)
            w = csv.writer(fp, delimiter=';')
            if p.stat().st_size == 0:
                w.writerow(header)
            setattr(self, 'w_' + name.split('.')[0], w)
            self._files.append(fp)
        self.last_error = None

    def receive(self, raw, ts=None):
        packet = decode(raw)
        if packet is None:
            return
        mac, fid, sdu, status, transfer = packet
        key = (mac, fid)
        if key not in self.flows:
            return
        ts = time.time() if ts is None else float(ts)
        valid = bool(status & 0x04) and transfer == 0
        with self.lock:
            flow = self.flow_state[key]
            flow['frames'] += 1
            flow['last_frame'] = ts
            m = self.by_signal.get(key)
            ms = self.machine_state[m['codice']] if m else None
            if ms is not None:
                if ms['last_frame'] is not None and ts - ms['last_frame'] > 5:
                    ms['level'] = None
                    ms['gap'] = True
                ms['frames'] += 1
                ms['last_frame'] = ts
                if not valid:
                    ms['invalid'] += 1
                    ms['level'] = None
            if not valid:
                flow['previous'] = None
                for (amac, afid, off, bit), (code, sig) in self.aux_signals.items():
                    if (amac, afid) == key:
                        self.aux_state[code]['sirena_livello'] = None
                return
            prev = flow['previous']
            if prev is not None and len(prev) == len(sdu):
                for idx, (old, new) in enumerate(zip(prev, sdu)):
                    mask = old ^ new
                    if not mask:
                        continue
                    for bit in range(8):
                        if not (mask & (1 << bit)):
                            continue
                        bk = (mac, fid, idx, bit)
                        info = self.bits.setdefault(bk, BitState(transizioni=0, salite=0, last=None))
                        info['transizioni'] += 1
                        rise = bool(new & (1 << bit))
                        if rise:
                            info['salite'] += 1
                        info['last'] = ts
                        self.w_transizioni.writerow([stamp(ts), mac, f'0x{fid:04X}', idx, bit, int(bool(old & (1<<bit))), int(rise)])
                        self.messages.put(('transition', mac, fid, idx, bit, rise, ts))
            flow['previous'] = bytes(sdu)
            for (amac, afid, off, bit), (code, sig) in self.aux_signals.items():
                if (amac, afid) != key or len(sdu) <= off:
                    continue
                st = self.aux_state[code]
                # A gap > 5s invalidates edge detection and prevents false counts.
                if flow['last_good_before'] is not None and ts-flow['last_good_before'] > 5:
                    st['sirena_livello'] = None
                level = (sdu[off] >> bit) & 1
                was = st['sirena_livello']
                if was == 0 and level == 1:
                    st['sirena_attivazioni'] += 1
                    st['sirena_ultimo'] = ts
                    self.w_attivazioni_sirena.writerow([stamp(ts), code, mac, f'0x{fid:04X}', off, bit, st['sirena_attivazioni']])
                    self.messages.put(('siren', code, st['sirena_attivazioni'], ts))
                st['sirena_livello'] = level
            flow['last_good_before'] = ts
            if ms is not None:
                assert m is not None
                sig = m['segnale']
                off, bit = sig['byte'], sig['bit']
                if len(sdu) <= off:
                    return
                level = (sdu[off] >> bit) & 1
                if ms['level'] == 0 and level == 1:
                    ms['impulsi'] += 1
                    ms['pezzi'] += m['pezzi_per_impulso']
                    ms['previous'] = ms['last']
                    ms['last'] = ts
                    ms['hour'].append(ts)
                    self.w_impulsi.writerow([stamp(ts), m['codice'], mac, f'0x{fid:04X}', off, bit, ms['impulsi'], ms['pezzi'], m['pezzi_per_impulso']])
                    self.messages.put(('pulse', m['codice'], ms['impulsi'], ms['pezzi'], ts))
                ms['level'] = level

    def marker(self, machine, note):
        with self.lock:
            ts = time.time()
            self.w_marcatori.writerow([stamp(ts), machine, note])
            self.messages.put(('marker', machine, note, ts))

    def snapshot(self):
        now = time.time()
        with self.lock:
            rows = []
            for code, ms in self.machine_state.items():
                while ms['hour'] and ms['hour'][0] < now - 3600:
                    ms['hour'].popleft()
                m = self.machines[code]
                rows.append((code, m['nome'], m['stato'], ms['impulsi'], ms['pezzi'],
                             len(ms['hour'])*(m.get('pezzi_per_impulso') or 0), ms['last'],
                             ms['last']-ms['previous'] if ms['last'] is not None and ms['previous'] is not None else None,
                             ms['last_frame'], ms['frames'], ms['invalid'], ms['gap']))
            aux = {code: st.copy() for code, st in self.aux_state.items()}
            flows = [(f['nodo'], f['ip'], mac, f'0x{fid:04X}', self.flow_state[(mac,fid)]['frames'], self.flow_state[(mac,fid)]['last_frame'])
                     for (mac, fid), f in self.flows.items()]
            bits = [(mac, f'0x{fid:04X}', off, bit, v['transizioni'], v['salite'], v['last'])
                    for (mac, fid, off, bit), v in self.bits.items()]
            bits.sort(key=lambda t: (-t[4], t[0], t[2], t[3]))
            return rows, flows, bits, aux

    def close(self):
        with self.lock:
            for fp in self._files:
                fp.close()


def live(reader, interface, stop, errors):
    try:
        from scapy.all import sniff
        while not stop.is_set():
            sniff(iface=interface, prn=lambda p: reader.receive(bytes(p), float(p.time)), store=False, timeout=1)
    except Exception as exc:
        errors.put(str(exc))


def demo(reader, stop):
    """Fake frames only: intentionally independent of real capture and clearly labeled."""
    import random
    events = {key: time.time() for key in reader.flows}
    level = {key: 0 for key in reader.flows}
    while not stop.wait(0.04):
        now = time.time()
        for key in reader.flows:
            mac, fid = key
            period = 3.2 if fid == 0x8004 else (5.6 if fid == 0x8001 else (4.5 if fid == 0x8005 else 8 + (fid % 5)))
            elapsed = now - events[key]
            if elapsed >= period:
                events[key] = now
                level[key] = 0
            elif elapsed >= 0.20:
                level[key] = 1
            data = bytearray(40)
            data[4] = level[key] << 1
            # Static fake destination MAC and PN-RT data for local UI tests.
            raw = bytes.fromhex('ac6417f89a70') + bytes.fromhex(mac.replace(':','')) + b'\x88\x92' + struct.pack('!H', fid) + data + struct.pack('!HBB', 0, 0x35, 0)
            reader.receive(raw, now)
