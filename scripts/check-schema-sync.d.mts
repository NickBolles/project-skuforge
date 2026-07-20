export function normalizeSchema(schema: string): string;
export function schemasAreInSync(
  sqlitePath: string,
  postgresPath: string,
): Promise<boolean>;
