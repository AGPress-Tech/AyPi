import type { IncomingMessage, ServerResponse } from "http";
import { sendJson } from "./response";

type RouteHandler = (
    request: IncomingMessage,
    response: ServerResponse,
    params: Record<string, string>,
) => void | Promise<void>;

type Route = {
    method: string;
    pattern: RegExp;
    keys: string[];
    handler: RouteHandler;
};

function toPattern(pathname: string) {
    const keys: string[] = [];
    const pattern = pathname.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => {
        keys.push(key);
        return "([^/]+)";
    });
    return {
        keys,
        pattern: new RegExp(`^${pattern}$`),
    };
}

export class Router {
    private readonly routes: Route[] = [];

    register(method: string, pathname: string, handler: RouteHandler) {
        const { keys, pattern } = toPattern(pathname);
        this.routes.push({
            method: method.toUpperCase(),
            pattern,
            keys,
            handler,
        });
    }

    async handle(request: IncomingMessage, response: ServerResponse) {
        const method = (request.method || "GET").toUpperCase();
        const url = new URL(request.url || "/", "http://localhost");
        const pathname = url.pathname;

        for (const route of this.routes) {
            if (route.method !== method) continue;
            const match = pathname.match(route.pattern);
            if (!match) continue;
            const params = route.keys.reduce<Record<string, string>>(
                (accumulator, key, index) => {
                    accumulator[key] = decodeURIComponent(match[index + 1] || "");
                    return accumulator;
                },
                {},
            );
            await route.handler(request, response, params);
            return true;
        }

        sendJson(response, 404, {
            error: "Not Found",
            method,
            pathname,
        });
        return false;
    }
}
