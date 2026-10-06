import type * as http from "node:http";
import type * as https from "node:https";
import {Readable} from "node:stream";
import {
    type BodyInit as V1BodyInit,
    type Config,
    fetch as v1Fetch,
} from "@databricks/sdk-experimental";
import type {Credentials} from "@databricks/sdk-auth";
import {setProduct} from "@databricks/sdk-core/clientinfo";
import type {HttpClient} from "@databricks/sdk-core/http";
import type {ClientOptions} from "@databricks/sdk-options/client";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const EXTENSION_VERSION: string = require("../../package.json").version;

/**
 * V2 ClientOptions for a connected v1 Config. No `logger` yet: V2 logs
 * response bodies unredacted.
 */
export function v2ClientOptions(
    config: Config,
    host: URL,
    agent: http.Agent | https.Agent
): ClientOptions {
    // Global, and read when a client is built. Repeating it is a no-op.
    setProduct("databricks-vscode", EXTENSION_VERSION);
    return {
        host: host.origin,
        workspaceId: config.workspaceId,
        credentials: v2Credentials(config),
        httpClient: agentHttpClient(agent),
        // Without this, V2 fills unset options from ~/.databrickscfg and
        // DATABRICKS_* variables, which may name another workspace.
        profileOptions: {noProfile: true, disableEnv: true},
    };
}

/**
 * V2 SDK credentials that authenticate through a v1 `Config`, so every v1 auth
 * type works, including Azure CLI, which V2 doesn't support.
 */
export function v2Credentials(config: Config): Credentials {
    return {
        name: () => config.authType ?? "default",
        authHeaders: async () => {
            const headers = new Headers();
            await config.authenticate(headers);
            return [...headers].map(([key, value]) => ({key, value}));
        },
    };
}

/**
 * A V2 transport over v1's fetch, so requests go through the extension's
 * proxy- and CA-aware agent (`databricks.proxy.caCert` included), which V2's
 * default global fetch ignores. v1's fetch only sends a body with POST or PUT,
 * so V2's PATCH-based update methods fail through it.
 */
export function agentHttpClient(agent: http.Agent | https.Agent): HttpClient {
    return {
        async send({url, method, headers, body, signal}) {
            const response = await v1Fetch(url, {
                method,
                headers,
                signal,
                agent,
                body:
                    body instanceof ArrayBuffer || body instanceof Uint8Array
                        ? Readable.from(Buffer.from(new Uint8Array(body)))
                        : (body as V1BodyInit | null | undefined) ?? undefined,
            });
            return {
                statusCode: response.status,
                headers: response.headers,
                body: response.body as ReadableStream<Uint8Array>,
            };
        },
    };
}
