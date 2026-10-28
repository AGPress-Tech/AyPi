import type { Router } from '../../shared/http/router';
import { badRequest } from '../../shared/http/errors';
import { sendJson } from '../../shared/http/response';
import { fornoRequest, getFornoStatus } from './service';

/** API di sola consultazione: nessun client modifica il campionamento centrale. */
export function registerFornoRoutes(router: Router) {
    router.register('GET', '/api/forno/status', async (_request, response) => {
        sendJson(response, 200, await getFornoStatus());
    });
    router.register('GET', '/api/forno/history', async (request, response) => {
        const query = new URL(request.url || '/', 'http://localhost').searchParams;
        const fromMs = Number(query.get('fromMs'));
        const toMs = Number(query.get('toMs'));
        const intervalMs = Number(query.get('intervalMs') || 500);
        const maxPoints = Number(query.get('maxPoints') || 2000);
        if (!query.has('fromMs') || !query.has('toMs') ||
            !Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs) || fromMs < 0 || toMs < fromMs || toMs-fromMs > 366*86400000 ||
            !Number.isSafeInteger(intervalMs) || intervalMs < 500 || intervalMs > 366*86400000 ||
            !Number.isSafeInteger(maxPoints) || maxPoints < 1 || maxPoints > 4000) {
            throw badRequest('Intervallo forno non valido: fromMs/toMs UTC, massimo 366 giorni, intervalMs >= 500, maxPoints 1–4000');
        }
        sendJson(response, 200, await fornoRequest('history', { fromMs, toMs, intervalMs, maxPoints }));
    });
}
