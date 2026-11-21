import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StaleHotelNotice, checkForSwitchedHotel, reactionToSwitch } from "./current-property-watch";

const reply = (body: unknown, ok = true) => async () => ({ ok, json: async () => body }) as Response;

describe("CurrentPropertyWatch", () => {
  test("shows the notice when the server's hotel differs", async () => {
    const found = await checkForSwitchedHotel("p-a", reply({ propertyId: "p-b", propertyName: "Hotel Bravo" }));
    expect(found).toEqual({ hotelName: "Hotel Bravo" });
    const html = renderToStaticMarkup(<StaleHotelNotice hotelName="Hotel Bravo" onReload={() => {}} />);
    expect(html).toContain("You switched to Hotel Bravo in another tab.");
    expect(html).toContain("Reload");
  });

  test("stays quiet when it matches", async () => {
    expect(await checkForSwitchedHotel("p-a", reply({ propertyId: "p-a", propertyName: "Hotel Alpha" }))).toBeNull();
  });

  test("stays quiet on errors, an unauthorized reply, or nothing rendered", async () => {
    expect(await checkForSwitchedHotel("p-a", async () => { throw new Error("offline"); })).toBeNull();
    expect(await checkForSwitchedHotel("p-a", reply({ error: "unauthorized" }, false))).toBeNull();
    expect(await checkForSwitchedHotel("p-a", reply({ propertyId: null, propertyName: null }))).toBeNull();
    expect(await checkForSwitchedHotel(null, reply({ propertyId: "p-b", propertyName: "Hotel Bravo" }))).toBeNull();
  });

  test("a switch found on focus is another tab's: show the notice", () => {
    expect(reactionToSwitch("focus")).toBe("notice");
  });

  test("a switch found after an in-tab navigation is this tab's: refresh the layout, no notice", () => {
    expect(reactionToSwitch("navigation")).toBe("refresh");
  });
});
