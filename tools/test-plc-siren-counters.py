"""Verify the configured siren rising edges feed the normal MES piece CSV."""
import csv
import json
import struct
import sys
import tempfile
from pathlib import Path

source = Path(__file__).resolve().parents[1] / 'src/renderer/templates/plc-reader'
sys.path.insert(0, str(source))
from reader import Reader

config = json.loads((source / 'macchine.json').read_text(encoding='utf-8'))
with tempfile.TemporaryDirectory(prefix='aypi-siren-counters-') as folder:
    reader = Reader(config, folder)
    try:
        for code in ('21F400', '21D300'):
            machine = reader.machines[code]
            signal = machine['segnale']
            assert signal['tipo'] == 'sirena'
            assert machine['pezzi_per_impulso'] == 1
            for index, level in enumerate((0, 1, 1, 0, 1)):
                payload = bytearray(40)
                payload[signal['byte']] = level << signal['bit']
                frame = (bytes(6) + bytes.fromhex(signal['mac'].replace(':', ''))
                         + b'\x88\x92' + struct.pack('!H', int(signal['frame_id'], 16))
                         + payload + b'\x00\x00\x04\x00')
                reader.receive(frame, ts=1700000000 + index / 10)
            state = reader.machine_state[code]
            assert state['impulsi'] == 2, (code, state)
            assert state['pezzi'] == 2, (code, state)
    finally:
        reader.close()
    with (Path(folder) / 'impulsi.csv').open(encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle, delimiter=';'))
    for code in ('21F400', '21D300'):
        counts = [row['pezzi_sessione'] for row in rows if row['macchina'] == code]
        assert counts == ['1', '2'], (code, counts)
print('PLC siren counters: OK')
