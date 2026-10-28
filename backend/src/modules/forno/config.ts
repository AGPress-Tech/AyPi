import path from 'path';
import { backendConfig } from '../../config';
import { resolveLocalDatabasePath } from './local-path';

const enabledByDefault = () => (process.env.AYPI_BACKEND_PROFILE || '').trim() !== 'dev';

/** Archivio separato: nessuna dipendenza dalla configurazione o dalle tabelle MES. */
export function getFornoConfig() {
    const flag = process.env.AYPI_FORNO_ENABLED?.trim().toLowerCase();
    const enabled = flag ? !['0', 'false', 'no', 'off'].includes(flag) : enabledByDefault();
    const configuredPath = process.env.AYPI_FORNO_DB_PATH || path.join(path.dirname(backendConfig.database.path), 'forno.db');
    const dbPath = enabled ? resolveLocalDatabasePath(configuredPath) : configuredPath;
    const intervalMs = Number(process.env.AYPI_FORNO_INTERVAL_MS || 500);
    const port = Number(process.env.AYPI_FORNO_PORT || 502);
    const unit = Number(process.env.AYPI_FORNO_UNIT || 255);
    const address = Number(process.env.AYPI_FORNO_ADDRESS || 256);
    if (!Number.isInteger(intervalMs) || intervalMs < 500 || intervalMs > 300000 ||
        !Number.isInteger(port) || port < 1 || port > 65535 ||
        !Number.isInteger(unit) || unit < 0 || unit > 255 ||
        !Number.isInteger(address) || address < 0 || address > 65522) {
        throw new Error('Configurazione forno non valida');
    }
    return {
        enabled,
        dbPath, intervalMs, port, unit, address,
        host: process.env.AYPI_FORNO_HOST || '192.168.1.165',
    };
}
