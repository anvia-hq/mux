import { describe, expect, it } from "bun:test";
import { lint } from "../testing/lint.mjs";

const rule = "no-base-ui-outside-ui";

describe(`zstack/${rule}`, () => {
  it("refuses a Base UI import outside the UI primitives layer", () => {
    expect(
      lint(
        rule,
        'import { Slider } from "@base-ui/react/slider";\n',
        "apps/web/src/modules/threads/components/effort.tsx",
      ),
    ).toHaveLength(1);
  });

  it("allows a Base UI import inside packages/ui or src/components", () => {
    expect(
      lint(rule, 'import { Slider } from "@base-ui/react/slider";\n', "packages/ui/src/slider.tsx"),
    ).toHaveLength(0);
    expect(
      lint(rule, 'import { Slider } from "@base-ui/react/slider";\n', "src/components/slider.tsx"),
    ).toHaveLength(0);
  });
});
