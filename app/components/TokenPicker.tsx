import { TOKEN_REFERENCE } from "../core/sku";

export interface TokenPickerProps {
  onPick?: (syntax: string) => void;
}

export function TokenPicker({ onPick }: TokenPickerProps) {
  return (
    <div aria-label="SKU token palette">
      <p><strong>Token palette</strong></p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TOKEN_REFERENCE.map((token) => {
          const syntax = token.syntax.split(" ")[0]!.replace("[:N]", "");
          return (
            <button key={token.syntax} type="button" title={token.description} onClick={() => onPick?.(syntax)}>
              {syntax}
            </button>
          );
        })}
      </div>
    </div>
  );
}
