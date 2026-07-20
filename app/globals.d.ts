declare module "*.css";

declare module "papaparse" {
  interface ParseError { row?: number; message: string }
  interface ParseResult<T> { data: T[]; errors: ParseError[]; meta: { fields?: string[] } }
  interface PapaParse {
    parse<T>(source: string, options: {
      header: true;
      skipEmptyLines: "greedy";
      dynamicTyping: false;
      transformHeader: (header: string) => string;
    }): ParseResult<T>;
    unparse(rows: unknown[], options: { columns: string[]; header: boolean; newline: string }): string;
  }
  const Papa: PapaParse;
  export default Papa;
}
