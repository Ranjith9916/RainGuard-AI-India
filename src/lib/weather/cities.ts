/**
 * 16 major Indian cities served as the default monitoring network.
 *
 * Coordinates are sourced from the Census of India / Survey of India
 * gazetteer. Populations are 2011 census figures for the city proper (not
 * urban-agglomeration) — accurate enough for risk stratification, not for
 * demographic claims.
 *
 * Each entry carries a `riskNote` — a short, human-readable reason for why
 * the city is included in the network. The risk notes surface in the UI as
 * tooltips and in alert payloads as supplementary context.
 */

export interface City {
  id: string;
  name: string;
  state: string;
  latitude: number;
  longitude: number;
  /** 2011 census population (city proper) */
  population: number;
  /** Elevation above mean sea level, metres (approximate) */
  elevationM?: number;
  /** Short note explaining why this city is in the network */
  riskNote: string;
}

export const CITIES: City[] = [
  {
    id: "chennai",
    name: "Chennai",
    state: "Tamil Nadu",
    latitude: 13.0827,
    longitude: 80.2707,
    population: 4646732,
    elevationM: 7,
    riskNote:
      "Coastal megacity; vulnerable to NE-monsoon depressions, 2015 flood reference.",
  },
  {
    id: "mumbai",
    name: "Mumbai",
    state: "Maharashtra",
    latitude: 19.076,
    longitude: 72.8777,
    population: 12442373,
    elevationM: 14,
    riskNote:
      "Low-lying island city; Mithi river bottleneck and 26-Jul-2005 cloudburst reference.",
  },
  {
    id: "delhi",
    name: "Delhi",
    state: "Delhi NCR",
    latitude: 28.7041,
    longitude: 77.1025,
    population: 11034555,
    elevationM: 216,
    riskNote:
      "Yamuna floodplain; urban drainage overload and upstream Hathnikund releases.",
  },
  {
    id: "kolkata",
    name: "Kolkata",
    state: "West Bengal",
    latitude: 22.5726,
    longitude: 88.3639,
    population: 4496694,
    elevationM: 9,
    riskNote:
      "Hooghly tidal reach; cyclone-driven surge and saturated clay drainage.",
  },
  {
    id: "hyderabad",
    name: "Hyderabad",
    state: "Telangana",
    latitude: 17.385,
    longitude: 78.4867,
    population: 6809970,
    elevationM: 542,
    riskNote:
      "Musistorm-prone plateau; 2020 deluge reference and tank-breach cascade.",
  },
  {
    id: "bengaluru",
    name: "Bengaluru",
    state: "Karnataka",
    latitude: 12.9716,
    longitude: 77.5946,
    population: 8443675,
    elevationM: 920,
    riskNote:
      "Plateau with destroyed lake network; intense concretisation-driven runoff.",
  },
  {
    id: "ahmedabad",
    name: "Ahmedabad",
    state: "Gujarat",
    latitude: 23.0225,
    longitude: 72.5714,
    population: 5570585,
    elevationM: 53,
    riskNote:
      "Sabarmati basin; cyclone-remnant rain and urban-heat driven storms.",
  },
  {
    id: "pune",
    name: "Pune",
    state: "Maharashtra",
    latitude: 18.5204,
    longitude: 73.8567,
    population: 3124458,
    elevationM: 560,
    riskNote:
      "Mula-Mutha confluence; dam releases and ghats-shadow orographic rain.",
  },
  {
    id: "surat",
    name: "Surat",
    state: "Gujarat",
    latitude: 21.1702,
    longitude: 72.8311,
    population: 4467797,
    elevationM: 13,
    riskNote:
      "Tapi estuary; Ukai dam release scheduling critical for the city.",
  },
  {
    id: "jaipur",
    name: "Jaipur",
    state: "Rajasthan",
    latitude: 26.9124,
    longitude: 75.7873,
    population: 3046163,
    elevationM: 431,
    riskNote:
      "Semi-arid; flash-flood prone during intense monsoon depressions.",
  },
  {
    id: "lucknow",
    name: "Lucknow",
    state: "Uttar Pradesh",
    latitude: 26.8467,
    longitude: 80.9462,
    population: 2815601,
    elevationM: 123,
    riskNote:
      "Gomti floodplain; riverine flood risk and poor stormwater coverage.",
  },
  {
    id: "patna",
    name: "Patna",
    state: "Bihar",
    latitude: 25.5941,
    longitude: 85.1376,
    population: 1684222,
    elevationM: 53,
    riskNote:
      "Ganga south bank; riverine flooding + 2019 urban deluge reference.",
  },
  {
    id: "guwahati",
    name: "Guwahati",
    state: "Assam",
    latitude: 26.1445,
    longitude: 91.7362,
    population: 957352,
    elevationM: 55,
    riskNote:
      "Brahmaputra valley; chronic seasonal flooding and hill-cutting runoff.",
  },
  {
    id: "bhubaneswar",
    name: "Bhubaneswar",
    state: "Odisha",
    latitude: 20.2961,
    longitude: 85.8245,
    population: 837737,
    elevationM: 45,
    riskNote:
      "Cyclone corridor on Bay of Bengal; storm surge and remnant rain.",
  },
  {
    id: "visakhapatnam",
    name: "Visakhapatnam",
    state: "Andhra Pradesh",
    latitude: 17.6868,
    longitude: 83.2185,
    population: 1730320,
    elevationM: 45,
    riskNote:
      "Coastal cyclone landfall corridor; 2014 Hudhud reference.",
  },
  {
    id: "kochi",
    name: "Kochi",
    state: "Kerala",
    latitude: 9.9312,
    longitude: 76.2673,
    population: 601574,
    elevationM: 1,
    riskNote:
      "Sea-level backwater estuary; 2018 Kerala flood reference.",
  },
];

export function getCityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id);
}

export function findCityByName(name: string): City | undefined {
  const lower = name.trim().toLowerCase();
  return CITIES.find(
    (c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower,
  );
}

export default CITIES;
