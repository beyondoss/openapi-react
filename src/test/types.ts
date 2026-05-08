export interface Pet {
  id: number;
  name: string;
  status: "active" | "inactive";
  ownerId?: number;
}

export interface Owner {
  id: number;
  name: string;
  email: string;
}

export type ApiError = { error: { message: string } };

// The interface mirrors the shape `openapi-typescript` emits: every parameter
// and `requestBody` slot is always present, with `?: never` standing in for
// "absent". This is the canonical contract the library targets, so test types
// should follow the same convention as real generated types.
export interface TestPaths {
  "/pets": {
    get: {
      parameters: {
        query?: { limit?: number; status?: "active" | "inactive" };
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        200: { content: { "application/json": Pet[] } };
        500: { content: { "application/json": ApiError } };
      };
    };
    post: {
      parameters: {
        query?: never;
        header?: never;
        path?: never;
        cookie?: never;
      };
      requestBody: {
        content: { "application/json": Omit<Pet, "id"> };
      };
      responses: {
        201: { content: { "application/json": Pet } };
        400: { content: { "application/json": ApiError } };
      };
    };
  };
  "/pets/{id}": {
    get: {
      parameters: {
        query?: { include?: "owner"[] };
        header?: never;
        path: { id: number };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        200: { content: { "application/json": Pet } };
        404: { content: { "application/json": ApiError } };
      };
    };
    put: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: number };
        cookie?: never;
      };
      requestBody: {
        content: { "application/json": Partial<Omit<Pet, "id">> };
      };
      responses: {
        200: { content: { "application/json": Pet } };
        404: { content: { "application/json": ApiError } };
      };
    };
    delete: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: number };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        204: { content: never };
        404: { content: { "application/json": ApiError } };
      };
    };
  };
  "/owners/{id}": {
    get: {
      parameters: {
        query?: never;
        header?: never;
        path: { id: number };
        cookie?: never;
      };
      requestBody?: never;
      responses: {
        200: { content: { "application/json": Owner } };
        404: { content: { "application/json": ApiError } };
      };
    };
  };
}
