import catalogue from "./catalogue.json";
import {
  type Workspace,
  type Entry,
  emptyEntry,
  emptyPlace,
  cloneScenario,
  uid,
} from "./model";
export function seedWorkspace(): Workspace {
  const places = catalogue.map((p) => ({ ...emptyPlace(), ...p }));
  const find = (fragment: string) =>
    places.find((p) => p.name.includes(fragment));
  const make = (
    type: Entry["type"],
    title: string,
    date: string,
    city: string,
    country = "Japan",
    more: Partial<Entry> = {},
  ): Entry => ({
    ...emptyEntry(date, type),
    type,
    title,
    city,
    country,
    status: "planned",
    notes: "Sample plan. Dates and details are examples.",
    ...more,
  });
  const activity = (
    fragment: string,
    date: string,
    time: string,
    end: string,
  ) => {
    const p = find(fragment)!;
    return make("activity", p.name, date, p.city, p.country, {
      placeId: p.id,
      startTime: time,
      endTime: end,
    });
  };
  const korea = {
    timezone: "Asia/Seoul",
    endTimezone: "Asia/Seoul",
    currency: "KRW",
  };
  const entries: Entry[] = [
    make(
      "transport",
      "Flight to Tokyo",
      "2027-04-01",
      "Singapore",
      "Singapore",
      {
        toCity: "Tokyo",
        toCountry: "Japan",
        mode: "Flight",
        startTime: "23:00",
        endTime: "07:00",
        endDate: "2027-04-02",
        timezone: "Asia/Singapore",
        endTimezone: "Asia/Tokyo",
      },
    ),
    make("stay", "Tokyo · hotel to choose", "2027-04-02", "Tokyo", "Japan", {
      endDate: "2027-04-06",
    }),
    activity("Senso-ji", "2027-04-03", "08:00", "10:30"),
    activity("teamLab", "2027-04-03", "15:00", "17:00"),
    activity("Meiji Jingu", "2027-04-04", "09:00", "11:00"),
    make("transport", "Tokyo → Kyoto", "2027-04-06", "Tokyo", "Japan", {
      toCity: "Kyoto",
      toCountry: "Japan",
      mode: "Shinkansen",
      startTime: "10:00",
      endTime: "12:15",
    }),
    make("stay", "Kyoto · hotel to choose", "2027-04-06", "Kyoto", "Japan", {
      endDate: "2027-04-09",
    }),
    activity("Fushimi Inari", "2027-04-07", "07:30", "10:30"),
    activity("Kinkaku-ji", "2027-04-07", "14:00", "16:00"),
    { ...activity("Nara Park", "2027-04-08", "09:00", "16:00"), city: "Kyoto" },
    make("stay", "Osaka · hotel to choose", "2027-04-09", "Osaka", "Japan", {
      endDate: "2027-04-11",
    }),
    activity("Osaka Castle", "2027-04-10", "10:00", "13:00"),
    make("transport", "Osaka → Hakata", "2027-04-11", "Osaka", "Japan", {
      toCity: "Fukuoka",
      toCountry: "Japan",
      mode: "Shinkansen",
      startTime: "10:00",
      endTime: "12:30",
    }),
    make("stay", "Hakata · hotel to choose", "2027-04-11", "Fukuoka", "Japan", {
      endDate: "2027-04-12",
    }),
    make("transport", "Hakata → Busan", "2027-04-12", "Fukuoka", "Japan", {
      toCity: "Busan",
      toCountry: "Korea",
      mode: "Ferry",
      startTime: "12:30",
      endTime: "18:30",
      endTimezone: "Asia/Seoul",
    }),
    make("stay", "Busan · hotel to choose", "2027-04-12", "Busan", "Korea", {
      endDate: "2027-04-14",
      ...korea,
    }),
    { ...activity("Gamcheon", "2027-04-13", "10:00", "13:00"), ...korea },
    make("transport", "Busan → Seoul", "2027-04-14", "Busan", "Korea", {
      toCity: "Seoul",
      toCountry: "Korea",
      mode: "Train",
      startTime: "10:00",
      endTime: "12:40",
      ...korea,
    }),
    make("stay", "Seoul · hotel to choose", "2027-04-14", "Seoul", "Korea", {
      endDate: "2027-04-17",
      ...korea,
    }),
    { ...activity("Gyeongbokgung", "2027-04-15", "09:30", "12:00"), ...korea },
    { ...activity("Bukchon", "2027-04-15", "13:00", "15:00"), ...korea },
    make("transport", "Flight home", "2027-04-17", "Seoul", "Korea", {
      toCity: "Singapore",
      toCountry: "Singapore",
      mode: "Flight",
      startTime: "11:00",
      endTime: "16:30",
      timezone: "Asia/Seoul",
      endTimezone: "Asia/Singapore",
      currency: "KRW",
    }),
  ];
  const primary = {
    id: uid(),
    name: "Main plan",
    description: "Sample trip · edit or delete it to start your own.",
    entries,
  };
  const alternate = cloneScenario(primary, "Longer in Kyoto");
  alternate.description = "Skip Osaka and stay in Kyoto for two more nights.";
  alternate.entries = alternate.entries.filter(
    (e) => e.city !== "Osaka" || e.type === "transport",
  );
  const kyoto = alternate.entries.find(
    (e) => e.type === "stay" && e.city === "Kyoto",
  )!;
  kyoto.endDate = "2027-04-11";
  const departure = alternate.entries.find(
    (e) => e.title === "Osaka → Hakata",
  )!;
  departure.title = "Kyoto → Hakata";
  departure.city = "Kyoto";
  alternate.entries.push({
    ...activity("Osaka Castle", "2027-04-10", "10:00", "13:00"),
    city: "Kyoto",
  });
  const tripId = uid();
  return {
    version: 1,
    activeTripId: tripId,
    places,
    trips: [
      {
        id: tripId,
        name: "Sample trip: Japan and Korea",
        start: "2027-04-01",
        end: "2027-04-17",
        applicant: "",
        homeCurrency: "USD",
        scenarios: [primary, alternate],
        activeScenarioId: primary.id,
        tasks: [
          {
            id: uid(),
            title: "Japan visa & schedule of stay",
            due: "",
            done: false,
            country: "Japan",
            url: "https://www.mofa.go.jp/files/000433544.pdf",
          },
          {
            id: uid(),
            title: "Check entry requirements",
            due: "",
            done: false,
            country: "Korea",
            url: "https://www.k-eta.go.kr/",
          },
          {
            id: uid(),
            title: "Save hotel addresses in local languages",
            due: "",
            done: false,
            country: "",
            url: "",
          },
        ],
      },
    ],
  };
}
