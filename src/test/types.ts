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

export interface TestPaths {
  "/pets": {
    get: {
      parameters: {
        query?: { limit?: number; status?: "active" | "inactive" };
      };
      responses: {
        200: { content: { "application/json": Pet[] } };
        500: { content: { "application/json": ApiError } };
      };
    };
    post: {
      parameters: {};
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
        path: { id: number };
        query?: { include?: "owner"[] };
      };
      responses: {
        200: { content: { "application/json": Pet } };
        404: { content: { "application/json": ApiError } };
      };
    };
    put: {
      parameters: { path: { id: number } };
      requestBody: {
        content: { "application/json": Partial<Omit<Pet, "id">> };
      };
      responses: {
        200: { content: { "application/json": Pet } };
        404: { content: { "application/json": ApiError } };
      };
    };
    delete: {
      parameters: { path: { id: number } };
      responses: {
        204: { content: never };
        404: { content: { "application/json": ApiError } };
      };
    };
  };
  "/owners/{id}": {
    get: {
      parameters: { path: { id: number } };
      responses: {
        200: { content: { "application/json": Owner } };
        404: { content: { "application/json": ApiError } };
      };
    };
  };
}
