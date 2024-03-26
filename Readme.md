## Tiny express-like library for AWS Lambda with LLRT

Use like:

```ts
// lambda.ts
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

import app from "./app";

// Your AWS Lambda handler
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  return app.getLambdaResponse(event, context);
};
```

```ts
// app.ts
import express, { NextFunction, Request, Response, Router } from "./express";

const app = express();

export default app;
```
