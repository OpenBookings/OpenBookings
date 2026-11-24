import { expect, test } from "bun:test";
import { appName } from "./names";

test("first and last name map to given name and surname as typed", () => {
  expect(appName("Anna de", "Vries")).toEqual({ givenName: "Anna de", surname: "Vries" });
});

test("no last name: the first name becomes the surname (SiteMinder requires one)", () => {
  expect(appName("Cher", "")).toEqual({ givenName: "", surname: "Cher" });
  expect(appName("Cher", "   ")).toEqual({ givenName: "", surname: "Cher" });
});

test("no name at all: surname Guest", () => {
  expect(appName("", "")).toEqual({ givenName: "", surname: "Guest" });
  expect(appName(" ", "\t")).toEqual({ givenName: "", surname: "Guest" });
});

test("apostrophes, diacritics and non-Latin scripts pass through unchanged", () => {
  expect(appName("Zoë", "O'Brien")).toEqual({ givenName: "Zoë", surname: "O'Brien" });
  expect(appName("Ἀλέξανδρος", "Παπαδόπουλος")).toEqual({ givenName: "Ἀλέξανδρος", surname: "Παπαδόπουλος" });
  expect(appName("O'Brien & Zoë", "")).toEqual({ givenName: "", surname: "O'Brien & Zoë" });
});
