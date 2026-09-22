import { describe, expect, it, vi } from "vitest";
import { buildEmbeddedQrSvg } from "../production/StoreQrInviteManager";
import { storeJoinTokenFromLocation, storeJoinUrl } from "../production/storeJoinRoute";

describe("storeQrInviteManager", () => {
  describe("buildEmbeddedQrSvg", () => {
    interface MockElement {
      tagName: string;
      attributes: Record<string, string>;
      children: MockElement[];
      setAttribute(name: string, value: string): void;
      setAttributeNS(namespace: string | null, name: string, value: string): void;
      appendChild(child: MockElement): MockElement;
      cloneNode(deep?: boolean): MockElement;
    }

    function createMockElement(tagName: string): MockElement {
      const attributes: Record<string, string> = {};
      const children: MockElement[] = [];
      return {
        tagName,
        attributes,
        children,
        setAttribute(name: string, value: string) {
          attributes[name] = value;
        },
        setAttributeNS(_ns: string | null, name: string, value: string) {
          attributes[name] = value;
        },
        appendChild(child: MockElement) {
          children.push(child);
          return child;
        },
        cloneNode(_deep?: boolean) {
          const clone = createMockElement(tagName);
          Object.assign(clone.attributes, attributes);
          clone.children.push(...children.map((c) => c.cloneNode(true)));
          return clone;
        },
      };
    }

    it("scales source SVG to 1200x1200 with XML namespaces and without logo when logoUrl is empty", () => {
      const source = createMockElement("svg") as unknown as SVGElement;
      const result = buildEmbeddedQrSvg(source, null) as unknown as MockElement;

      expect(result.attributes["width"]).toBe("1200");
      expect(result.attributes["height"]).toBe("1200");
      expect(result.attributes["xmlns"]).toBe("http://www.w3.org/2000/svg");
      expect(result.children).toHaveLength(0);
    });

    it("embeds a centered logo badge and image tag when logoUrl is supplied", () => {
      const origDocument = globalThis.document;
      globalThis.document = {
        createElementNS: vi.fn((_ns: string, tagName: string) => createMockElement(tagName)),
      } as unknown as Document;

      try {
        const source = createMockElement("svg") as unknown as SVGElement;
        const logoUrl = "https://example.com/store-badge.png";
        const result = buildEmbeddedQrSvg(source, logoUrl) as unknown as MockElement;

        expect(result.attributes["width"]).toBe("1200");
        expect(result.attributes["height"]).toBe("1200");

        expect(result.children).toHaveLength(1);
        const group = result.children[0];
        expect(group.tagName).toBe("g");
        expect(group.children).toHaveLength(2);

        const badgeRect = group.children[0];
        expect(badgeRect.tagName).toBe("rect");
        expect(badgeRect.attributes["fill"]).toBe("#fffaf1");
        expect(badgeRect.attributes["stroke"]).toBe("#091827");
        expect(badgeRect.attributes["width"]).toBe("280");
        expect(badgeRect.attributes["height"]).toBe("280");
        expect(badgeRect.attributes["rx"]).toBe("32");
        expect(badgeRect.attributes["x"]).toBe("460");
        expect(badgeRect.attributes["y"]).toBe("460");

        const logoImage = group.children[1];
        expect(logoImage.tagName).toBe("image");
        expect(logoImage.attributes["href"]).toBe(logoUrl);
        expect(logoImage.attributes["width"]).toBe("230");
        expect(logoImage.attributes["height"]).toBe("230");
        expect(logoImage.attributes["x"]).toBe("485");
        expect(logoImage.attributes["y"]).toBe("485");
      } finally {
        globalThis.document = origDocument;
      }
    });
  });

  describe("storeJoinUrl and parsing", () => {
    it("generates privacy-preserving fragment join URLs", () => {
      const url = storeJoinUrl("https://tcg-harbor.onrender.com/", "thq_deadbeef01234567");
      expect(url).toBe("https://tcg-harbor.onrender.com/join/store#token=thq_deadbeef01234567");
    });

    it("extracts token accurately from the URL hash fragment", () => {
      const token = storeJoinTokenFromLocation("/join/store", "#token=thq_deadbeef01234567");
      expect(token).toBe("thq_deadbeef01234567");
    });
  });
});
