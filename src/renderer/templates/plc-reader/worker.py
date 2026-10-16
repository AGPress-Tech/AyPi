"""Worker locale PROFINET: protocollo JSON lines per AyPi Electron."""
import argparse
import json
import queue
import sys
import threading
import time
from pathlib import Path
from reader import Reader, live, demo

parser = argparse.ArgumentParser()
parser.add_argument('--folder', required=True)
parser.add_argument('--mode', choices=['LIVE', 'DEMO'], default='LIVE')
parser.add_argument('--iface', default='')
parser.add_argument('--interfaces', action='store_true')
args = parser.parse_args()

def emit(value):
    print(json.dumps(value, ensure_ascii=True), flush=True)

if args.interfaces:
    from scapy.all import conf
    emit({'interfaces': [{'id': i.network_name, 'name': i.description or i.name}
                         for i in conf.ifaces.values()]})
    sys.exit(0)

cfg = json.loads(Path(__file__).with_name('macchine.json').read_text(encoding='utf-8'))
reader = Reader(cfg, args.folder)
stop = threading.Event()
errors = queue.Queue()
started = time.time()

def commands():
    for line in sys.stdin:
        try:
            command = json.loads(line)
            if command.get('kind') == 'stop':
                stop.set()
                return
            if command.get('kind') == 'marker':
                reader.marker(command['machine'], command['note'])
        except (ValueError, KeyError, TypeError):
            pass
    stop.set()

threading.Thread(target=commands, daemon=True).start()
thread = threading.Thread(target=demo if args.mode == 'DEMO' else live,
    args=(reader, stop) if args.mode == 'DEMO' else (reader, args.iface, stop, errors), daemon=True)
thread.start()
try:
    while not stop.is_set():
        if not errors.empty():
            emit({'error': errors.get()})
            break
        rows, flows, bits, aux = reader.snapshot()
        machines = []
        for code, name, mapping, pulses, pieces, hour, last, cycle, frame_time, frames, invalid, gap in rows:
            m = reader.machines[code]
            machines.append(dict(asset_type='machine', code=code, name=name, mapping=mapping,
                pulses=pulses, pieces=pieces, hour=hour, last=last, cycle=cycle,
                frame_time=frame_time, frames=frames, invalid=invalid, gap=gap,
                multiplier=m.get('pezzi_per_impulso'), signal=m.get('segnale'),
                device=m.get('dispositivo_profinet'),
                siren=aux[code]['sirena_attivazioni'], siren_last=aux[code]['sirena_ultimo']))
        by_flow = {}
        for m in reader.machines.values():
            signals = ([m['segnale']] if m.get('segnale') else []) + m.get('segnali_stato', [])
            for sig in signals:
                by_flow[(sig['mac'].lower(), int(sig['frame_id'], 16))] = m['codice']
            device = m.get('dispositivo_profinet')
            if device:
                by_flow[(device['mac'].lower(), int(device['frame_id'], 16))] = m['codice']
        events = []
        for _ in range(2000):
            try:
                e = reader.messages.get_nowait()
            except queue.Empty:
                break
            if e[0] == 'pulse':
                _, code, count, pieces, ts = e
                events.append(dict(kind='CONTATORE', machine=code, text=f'Impulso #{count} · {pieces} pezzi sessione', ts=ts))
            elif e[0] == 'siren':
                _, code, count, ts = e
                events.append(dict(kind='SIRENA', machine=code, text=f'Attivazione sirena #{count}', ts=ts))
            elif e[0] == 'marker':
                _, code, note, ts = e
                events.append(dict(kind='MARCATORE', machine=code, text=note, ts=ts))
            else:
                _, mac, fid, off, bit, rise, ts = e
                events.append(dict(kind='BIT', machine=by_flow.get((mac, fid), mac.upper()),
                    text=f'0x{fid:04X} · byte {off} · bit {bit} → {int(rise)}', ts=ts))
        flow_rows = []
        for node, ip, mac, fid, frames, last in flows:
            flow_key = (mac, int(fid, 16)) if fid.startswith('0x') else None
            flow_rows.append(dict(node=node, ip=ip, mac=mac.upper(), fid=fid,
                machine=by_flow.get(flow_key, 'Da identificare') if flow_key else 'Da identificare',
                frames=frames, last=last))
        emit(dict(mode=args.mode, now=time.time(), since=started, machines=machines,
            flows=flow_rows,
            bits=[dict(mac=mac.upper(), fid=fid, offset=off, bit=bit, changes=changes, rises=rises, last=last)
                for mac, fid, off, bit, changes, rises, last in bits[:250]], events=events))
        stop.wait(1)
finally:
    stop.set()
    thread.join(timeout=2)
    reader.close()
