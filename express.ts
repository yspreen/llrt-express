import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

export interface NextFunction {
  (err?: any): void;
  /**
   * "Break-out" of a router by calling {next('router')};
   * @see {https://expressjs.com/en/guide/using-middleware.html#middleware.router}
   */
  (deferToNext: "router"): void;
  /**
   * "Break-out" of a route by calling {next('route')};
   * @see {https://expressjs.com/en/guide/using-middleware.html#middleware.application}
   */
  (deferToNext: "route"): void;
}

export class Request {
  body?: any;
  headers: Record<string, string | string[]>;
  method: string;
  path: string;

  removePathPrefix(prefix: string) {
    this.path = this.path.substring(prefix.length);
  }

  addPathPrefix(prefix: string) {
    this.path = `${prefix}${this.path}`;
  }

  constructor(props: Omit<Request, "removePathPrefix" | "addPathPrefix">) {
    this.body = props.body;
    this.headers = props.headers;
    this.method = props.method;
    this.path = props.path;
  }
}

export class Response {
  resolver: (result: Response) => void;
  statusCode = 200;
  body = "";
  contentType = "text/html";

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(data: Record<string, any>): this {
    this.body = JSON.stringify(data);
    this.contentType = "application/json";
    this.finish();
    return this;
  }

  send(data: string): this {
    this.body = data;
    this.finish();
    return this;
  }

  finish() {
    this.resolver(this);
  }

  constructor(resolver: (result: Response) => void) {
    this.resolver = resolver;
  }
}

export interface Handler {
  (req: Request, res: Response): Promise<void>;
}

export interface Middleware {
  (req: Request, res: Response, next: NextFunction):
    | Promise<void | Response | Router>
    | void
    | Response
    | Router;
}

export interface Route {
  path: string;
  handler: Handler;
}

export class Router {
  private routes: { [key: string]: Route[] } = {};
  private middlewares = [
    (req: Request, res: Response) => {
      this.handleRequest(req, res);
    },
  ];

  post(path: string, handler: Handler): this {
    if (!this.routes["POST"]) {
      this.routes["POST"] = [];
    }
    this.routes["POST"].push({ path, handler });
    return this;
  }
  get(path: string, handler: Handler): this {
    if (!this.routes["GET"]) {
      this.routes["GET"] = [];
    }
    this.routes["GET"].push({ path, handler });
    return this;
  }
  put(path: string, handler: Handler): this {
    if (!this.routes["PUT"]) {
      this.routes["PUT"] = [];
    }
    this.routes["PUT"].push({ path, handler });
    return this;
  }
  delete(path: string, handler: Handler): this {
    if (!this.routes["DELETE"]) {
      this.routes["DELETE"] = [];
    }
    this.routes["DELETE"].push({ path, handler });
    return this;
  }
  all(path: string, handler: Handler): this {
    if (!this.routes["ALL"]) {
      this.routes["ALL"] = [];
    }
    this.routes["ALL"].push({ path, handler });
    return this;
  }

  private findRoute(method: string, path: string): Route | undefined {
    return this.routes[method]?.find((route) => route.path === path);
  }

  private async executeHandler(route: Route, req: Request, res: Response) {
    await route.handler(req, res);
  }

  private async notFound(req: Request, res: Response) {
    const handler = async (_: Request, res: Response) => {
      res.status(404).json({ message: "not found" });
    };
    const route: Route = {
      path: req.path,
      handler,
    };
    await this.executeHandler(route, req, res);
  }

  async getResponse(req: Request): Promise<APIGatewayProxyResult> {
    return new Promise((resolve) => {
      const res = new Response((res) => resolve(this.resToResponse(res)));
      this.middlewares[0](req, res);
    });
  }

  async getLambdaResponse(
    event: APIGatewayProxyEvent,
    context: Context
  ): Promise<APIGatewayProxyResult> {
    return this.getResponse(parseRequest(event, context));
  }

  private resToResponse(res: Response): APIGatewayProxyResult {
    return {
      statusCode: res.statusCode,
      body: res.body,
      headers: { "Content-Type": res.contentType },
    };
  }

  public use(middleware: Middleware): this;
  public use(path: string, router: Router): this;
  public use(middlewareOrPath: Middleware | string, router?: Router): this {
    const path = middlewareOrPath;
    if (typeof path === "string") return this.useRouter(path, router!);
    const middleware = middlewareOrPath as Middleware;

    const idx = this.middlewares.length - 1;
    const fun = (req: Request, res: Response) => {
      const next = () => {
        this.middlewares[idx + 1](req, res);
      };
      middleware(req, res, next);
    };
    this.middlewares.splice(idx, 0, fun);
    return this;
  }

  public useRouter(path: string, router: Router): this {
    return this.use((req, res, next) => {
      if (!req.path.startsWith(path)) return next();
      req.removePathPrefix(path);
      if (router.getRoute(req) === undefined) {
        req.addPathPrefix(path);
        return next();
      }
      router.handleRequest(req, res);
    });
  }

  private getRoute(req: Request): Route | undefined {
    const method = req.method;
    const path = req.path;
    const route = this.findRoute(method, path);
    if (route) return route;
    const allRoute = this.findRoute("ALL", path);
    if (allRoute) return allRoute;
  }

  private async handleRequest(req: Request, res: Response) {
    const route = this.getRoute(req);

    if (route) return this.executeHandler(route, req, res);

    // Default response for unhandled routes
    return this.notFound(req, res);
  }
}

export const App = Router;

// Function to create an app instance
function newApp() {
  return new App();
}
export default newApp;

function parseRequest(event: APIGatewayProxyEvent, context: Context): Request {
  let body;
  if (event.isBase64Encoded && event.body) {
    // Decode base64 body if it's base64 encoded
    const buffer = Buffer.from(event.body, "base64");
    body = buffer.toString("utf-8");
  } else {
    body = event.body;
  }

  // Attempt to parse the body as JSON, and fall back to the raw body if parsing fails
  try {
    body = JSON.parse(body ?? "");
  } catch (error) {
    // If there's an error, we assume it's because the body is not JSON, so we keep it as is
  }

  const headers = {
    ...event.headers,
    "x-apigateway-context": encodeURIComponent(
      JSON.stringify({ ...context, getRemainingTimeInMillis: undefined })
    ),
  };

  return new Request({
    body: body,
    headers: headers as Record<string, string | string[]>,
    method: event.httpMethod,
    path: event.path,
  });
}
