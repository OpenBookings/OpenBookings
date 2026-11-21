import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditAccessProvider, EditFieldset } from "@/components/dashboard/edit-access";
import { InfoTip } from "./info-tip";

/**
 * View-only roles see the property sections inside a disabled fieldset, which
 * disables every <button> in it. The field help has to keep opening there, so
 * its trigger is a focusable span with the button role, never a <button>.
 */
describe("InfoTip in a view-only form", () => {
  const html = renderToStaticMarkup(
    <EditAccessProvider canEdit={false} hotelName="Hotel Aurora">
      <EditFieldset>
        <input name="vatId" />
        <InfoTip label="VAT number">
          <p>Your VAT number.</p>
        </InfoTip>
      </EditFieldset>
    </EditAccessProvider>,
  );

  test("the form around it is disabled", () => {
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  test("the help trigger is not a button the fieldset can disable", () => {
    expect(html).not.toContain("<button");
    expect(html).toMatch(/<span[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="About vat number"/);
    expect(html).toContain('aria-haspopup="dialog"');
  });
});
