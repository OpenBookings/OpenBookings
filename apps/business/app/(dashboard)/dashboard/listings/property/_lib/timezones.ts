/**
 * The timezones offered in the editor: those of the 27 EU member states, where
 * OpenBookings properties are. A full IANA list would bury the dozen answers
 * that matter under four hundred that do not.
 *
 * Grouped by standard offset, which is how a host recognises their zone.
 */
export const EU_TIMEZONE_GROUPS: { label: string; zones: { value: string; label: string }[] }[] = [
  {
    label: "Azores (UTC−1)",
    zones: [{ value: "Atlantic/Azores", label: "Azores" }],
  },
  {
    label: "Western European (UTC+0)",
    zones: [
      { value: "Europe/Lisbon", label: "Lisbon" },
      { value: "Europe/Dublin", label: "Dublin" },
      { value: "Atlantic/Madeira", label: "Madeira" },
      { value: "Atlantic/Canary", label: "Canary Islands" },
    ],
  },
  {
    label: "Central European (UTC+1)",
    zones: [
      { value: "Europe/Amsterdam", label: "Amsterdam" },
      { value: "Europe/Berlin", label: "Berlin" },
      { value: "Europe/Bratislava", label: "Bratislava" },
      { value: "Europe/Brussels", label: "Brussels" },
      { value: "Europe/Budapest", label: "Budapest" },
      { value: "Europe/Copenhagen", label: "Copenhagen" },
      { value: "Europe/Ljubljana", label: "Ljubljana" },
      { value: "Europe/Luxembourg", label: "Luxembourg" },
      { value: "Europe/Madrid", label: "Madrid" },
      { value: "Europe/Malta", label: "Malta" },
      { value: "Europe/Paris", label: "Paris" },
      { value: "Europe/Prague", label: "Prague" },
      { value: "Europe/Rome", label: "Rome" },
      { value: "Europe/Stockholm", label: "Stockholm" },
      { value: "Europe/Vienna", label: "Vienna" },
      { value: "Europe/Warsaw", label: "Warsaw" },
      { value: "Europe/Zagreb", label: "Zagreb" },
    ],
  },
  {
    label: "Eastern European (UTC+2)",
    zones: [
      { value: "Europe/Athens", label: "Athens" },
      { value: "Europe/Bucharest", label: "Bucharest" },
      { value: "Europe/Helsinki", label: "Helsinki" },
      { value: "Asia/Nicosia", label: "Nicosia" },
      { value: "Europe/Riga", label: "Riga" },
      { value: "Europe/Sofia", label: "Sofia" },
      { value: "Europe/Tallinn", label: "Tallinn" },
      { value: "Europe/Vilnius", label: "Vilnius" },
    ],
  },
];

export const EU_TIMEZONES = new Set(EU_TIMEZONE_GROUPS.flatMap((g) => g.zones.map((z) => z.value)));
