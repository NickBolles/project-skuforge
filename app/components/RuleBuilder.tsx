import { useRef } from "react";
import { TokenPicker } from "./TokenPicker";
import type { RuleConfig } from "../services/rules.server";

export interface RuleBuilderValue {
  name: string;
  pattern: string;
  config: RuleConfig;
  isDefault: boolean;
  active: boolean;
}

export interface RuleBuilderProps {
  value: RuleBuilderValue;
  onChange?: (value: RuleBuilderValue) => void;
  patternError?: { message: string; position?: number } | null;
}

function csv(values: string[]): string {
  return values.join(", ");
}

function list(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function RuleBuilder({ value, onChange, patternError }: RuleBuilderProps) {
  const patternRef = useRef<HTMLInputElement>(null);
  const change = (patch: Partial<RuleBuilderValue>) => onChange?.({ ...value, ...patch });
  const config = (patch: Partial<RuleConfig>) => change({ config: { ...value.config, ...patch } });
  const scope = (patch: Partial<RuleConfig["scope"]>) => config({ scope: { ...value.config.scope, ...patch } });

  const insertToken = (token: string) => {
    const input = patternRef.current;
    const start = input?.selectionStart ?? value.pattern.length;
    const end = input?.selectionEnd ?? start;
    const pattern = value.pattern.slice(0, start) + token + value.pattern.slice(end);
    change({ pattern });
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <s-section heading="Rule builder">
      <div style={{ display: "grid", gap: 16 }}>
        <label>
          Rule name
          <input name="name" value={value.name} onChange={(event) => change({ name: event.currentTarget.value })} required />
        </label>
        <label>
          Pattern
          <input ref={patternRef} name="pattern" value={value.pattern} onChange={(event) => change({ pattern: event.currentTarget.value })} aria-invalid={Boolean(patternError)} aria-describedby="pattern-help" required style={{ width: "100%" }} />
        </label>
        <div id="pattern-help" role={patternError ? "alert" : undefined} style={{ color: patternError ? "#b42318" : undefined }}>
          {patternError ? `${patternError.message}${patternError.position === undefined ? "" : ` at position ${patternError.position}`}` : "Combine literal text with tokens; sequence padding uses {seq:4}."}
        </div>
        <TokenPicker onPick={insertToken} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label>
            Prefix
            <input name="prefix" value={value.config.prefix ?? ""} onChange={(event) => config({ prefix: event.currentTarget.value })} />
          </label>
          <label>
            Separator
            <input name="separator" value={value.config.separator ?? "-"} onChange={(event) => config({ separator: event.currentTarget.value })} />
          </label>
          <label>
            Casing
            <select name="casing" value={value.config.casing} onChange={(event) => config({ casing: event.currentTarget.value as RuleConfig["casing"] })}>
              <option value="upper">Uppercase</option>
              <option value="lower">Lowercase</option>
              <option value="asis">As entered</option>
            </select>
          </label>
          <label>
            Missing token
            <select name="missingValuePolicy" value={value.config.missingValuePolicy} onChange={(event) => config({ missingValuePolicy: event.currentTarget.value as RuleConfig["missingValuePolicy"] })}>
              <option value="skip-token">Skip token</option>
              <option value="placeholder">Use placeholder</option>
              <option value="error">Show error</option>
            </select>
          </label>
          <label>
            Missing placeholder
            <input name="missingPlaceholder" value={value.config.missingPlaceholder ?? "MISSING"} onChange={(event) => config({ missingPlaceholder: event.currentTarget.value })} />
          </label>
        </div>
        <label>
          Abbreviations (JSON)
          <textarea name="abbreviations" value={JSON.stringify(value.config.abbreviations, null, 2)} onChange={(event) => {
            try { config({ abbreviations: JSON.parse(event.currentTarget.value) as RuleConfig["abbreviations"] }); } catch { /* Preserve the last valid dictionary while typing. */ }
          }} rows={4} />
        </label>
        <s-section heading="Scope filters">
          <div style={{ display: "grid", gap: 8 }}>
            <label>Vendors (comma separated)<input name="vendors" value={csv(value.config.scope.vendors)} onChange={(event) => scope({ vendors: list(event.currentTarget.value) })} /></label>
            <label>Product types (comma separated)<input name="productTypes" value={csv(value.config.scope.productTypes)} onChange={(event) => scope({ productTypes: list(event.currentTarget.value) })} /></label>
            <label>Tags (match any, comma separated)<input name="tags" value={csv(value.config.scope.tags)} onChange={(event) => scope({ tags: list(event.currentTarget.value) })} /></label>
          </div>
        </s-section>
        <label><input type="checkbox" name="stripNonAlphanumeric" checked={value.config.stripNonAlphanumeric} onChange={(event) => config({ stripNonAlphanumeric: event.currentTarget.checked })} /> Strip non-alphanumeric token characters</label>
        <label><input type="checkbox" name="isDefault" checked={value.isDefault} onChange={(event) => change({ isDefault: event.currentTarget.checked })} /> Default rule for new-product automation</label>
        <label><input type="checkbox" name="active" checked={value.active} onChange={(event) => change({ active: event.currentTarget.checked })} /> Active</label>
        <input type="hidden" name="config" value={JSON.stringify(value.config)} />
      </div>
    </s-section>
  );
}
