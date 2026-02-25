import http, { type IncomingMessage, type ServerResponse } from "node:http";

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

type HttpServerHandle = {
  baseUrl: string;
  close: () => Promise<void>;
};

export async function createHttpServer(
  handler: HttpHandler,
): Promise<HttpServerHandle> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
