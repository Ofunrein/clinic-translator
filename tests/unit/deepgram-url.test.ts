import { describe, it, expect } from "vitest";
import { buildDeepgramUrl } from "@/lib/deepgram";

describe("buildDeepgramUrl", () => {
  it("defaults to nova-3", () => {
    const url = buildDeepgramUrl();
    expect(url).toContain("model=nova-3");
    expect(url).toContain("language=es");
    expect(url).toContain("encoding=linear16");
    expect(url).toContain("sample_rate=16000");
  });

  it("uses the supplied model", () => {
    expect(buildDeepgramUrl("flux-general-multi")).toContain(
      "model=flux-general-multi",
    );
  });

  it("uses nova-2 when supplied", () => {
    expect(buildDeepgramUrl("nova-2")).toContain("model=nova-2");
  });
});
