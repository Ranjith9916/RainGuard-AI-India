/**
 * Eight India flood-prone regions for SAR-based flood detection.
 *
 * The Sentinel-1 provider needs to know which regions to monitor because
 * satellite revisit time is 6-12 days — we can't cover all of India on
 * every pass. These 8 regions are the highest-priority monitoring targets
 * based on historical flood frequency (CWC / NDMA data).
 */

export interface IndiaRegion {
  id: string;
  name: string;
  states: string[];
  /** Centre latitude */
  latitude: number;
  /** Centre longitude */
  longitude: number;
  /** Approximate bounding box (degrees) */
  bbox: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  /** Why this region is monitored — for display in the UI */
  riskNote: string;
  /** Default cities to focus within the region */
  keyCities: string[];
  /** Place names to display on the hex grid map (cities, towns, rivers) */
  placeNames: Array<{
    name: string;
    /** Relative position on the 16x16 grid (row 0-15 top→bottom, col 0-15 left→right) */
    row: number;
    col: number;
    /** Optional: type of place for icon */
    type?: "city" | "river" | "district" | "landmark";
  }>;
}

export const INDIA_FLOOD_REGIONS: IndiaRegion[] = [
  {
    id: "ganga-brahmaputra-basin",
    name: "Ganga-Brahmaputra Basin",
    states: ["Assam", "Bihar", "West Bengal", "Uttar Pradesh"],
    latitude: 25.5,
    longitude: 86.0,
    bbox: { north: 28.5, south: 22.0, east: 91.0, west: 81.0 },
    riskNote:
      "Most flood-prone basin in India. Annual inundation during SW monsoon.",
    keyCities: ["patna", "guwahati", "kolkata"],
    placeNames: [
      { name: "PATNA", row: 4, col: 6, type: "city" },
      { name: "GAYA", row: 6, col: 7, type: "city" },
      { name: "BHAGALPUR", row: 3, col: 9, type: "city" },
      { name: "MURSHIDABAD", row: 5, col: 11, type: "district" },
      { name: "GANGA", row: 5, col: 9, type: "river" },
      { name: "KOSI", row: 3, col: 10, type: "river" },
      { name: "MALDA", row: 7, col: 12, type: "district" },
      { name: "BAHRAICH", row: 2, col: 5, type: "district" },
      { name: "GORAKHPUR", row: 2, col: 7, type: "city" },
    ],
  },
  {
    id: "brahmaputra-valley",
    name: "Brahmaputra Valley",
    states: ["Assam", "Arunachal Pradesh"],
    latitude: 26.5,
    longitude: 92.0,
    bbox: { north: 28.0, south: 24.5, east: 96.0, west: 89.0 },
    riskNote:
      "Chronic seasonal flooding; braided channel migration and bank erosion.",
    keyCities: ["guwahati"],
    placeNames: [
      { name: "GUWAHATI", row: 8, col: 6, type: "city" },
      { name: "DIBRUGARH", row: 3, col: 9, type: "city" },
      { name: "TEZPUR", row: 5, col: 6, type: "city" },
      { name: "JORHAT", row: 4, col: 8, type: "city" },
      { name: "BRAHMAPUTRA", row: 7, col: 7, type: "river" },
      { name: "SUBANSIRI", row: 6, col: 5, type: "river" },
      { name: "MAJULI", row: 6, col: 8, type: "landmark" },
      { name: "Dhubri", row: 10, col: 4, type: "district" },
      { name: "LAKHIMPUR", row: 4, col: 10, type: "district" },
    ],
  },
  {
    id: "gangetic-plains-bihar",
    name: "Gangetic Plains (Bihar)",
    states: ["Bihar"],
    latitude: 25.7,
    longitude: 85.3,
    bbox: { north: 27.5, south: 24.0, east: 88.0, west: 83.0 },
    riskNote:
      "Kosi / Gandak / Bagmati floodplains; embankment breaches common.",
    keyCities: ["patna"],
    placeNames: [
      { name: "PATNA", row: 6, col: 5, type: "city" },
      { name: "GAYA", row: 9, col: 5, type: "city" },
      { name: "DARBHANGA", row: 4, col: 7, type: "city" },
      { name: "BHAGALPUR", row: 5, col: 10, type: "city" },
      { name: "KOSI RIVER", row: 3, col: 9, type: "river" },
      { name: "GANDAK", row: 5, col: 3, type: "river" },
      { name: "BAGMATI", row: 4, col: 6, type: "river" },
      { name: "Muzaffarpur", row: 4, col: 6, type: "district" },
      { name: "SUPAUL", row: 2, col: 9, type: "district" },
    ],
  },
  {
    id: "maharashtra-coastal",
    name: "Maharashtra Coastal",
    states: ["Maharashtra"],
    latitude: 19.0,
    longitude: 73.0,
    bbox: { north: 20.5, south: 16.0, east: 74.5, west: 71.0 },
    riskNote:
      "Mumbai metropolitan area + Konkan coast. Cloudburst + urban flooding.",
    keyCities: ["mumbai", "pune"],
    placeNames: [
      { name: "MUMBAI", row: 5, col: 3, type: "city" },
      { name: "PUNE", row: 8, col: 5, type: "city" },
      { name: "THANE", row: 4, col: 4, type: "city" },
      { name: "NAVI MUMBAI", row: 6, col: 4, type: "city" },
      { name: "MITHI R.", row: 5, col: 4, type: "river" },
      { name: "RATNAGIRI", row: 10, col: 2, type: "district" },
      { name: "RAIGAD", row: 7, col: 3, type: "district" },
      { name: "ULHAS R.", row: 3, col: 5, type: "river" },
      { name: "ALIBAUG", row: 8, col: 2, type: "landmark" },
    ],
  },
  {
    id: "tamil-nadu-coastal",
    name: "Tamil Nadu Coastal",
    states: ["Tamil Nadu"],
    latitude: 12.5,
    longitude: 79.8,
    bbox: { north: 14.0, south: 10.5, east: 80.5, west: 78.0 },
    riskNote:
      "NE-monsoon coastal flooding; 2015 Chennai floods reference.",
    keyCities: ["chennai"],
    placeNames: [
      { name: "CHENNAI", row: 5, col: 8, type: "city" },
      { name: "KANCHIPURAM", row: 7, col: 6, type: "district" },
      { name: "COOUM R.", row: 4, col: 8, type: "river" },
      { name: "ADYAR R.", row: 6, col: 9, type: "river" },
      { name: "VELACHERY", row: 8, col: 9, type: "district" },
      { name: "TIRUVALLUR", row: 3, col: 6, type: "district" },
      { name: "PULICAT", row: 2, col: 10, type: "landmark" },
      { name: "MAHABALIPURAM", row: 7, col: 11, type: "landmark" },
      { name: "KORATTUR", row: 5, col: 7, type: "district" },
    ],
  },
  {
    id: "godavari-krishna-basin",
    name: "Godavari-Krishna Basin",
    states: ["Telangana", "Andhra Pradesh", "Maharashtra", "Karnataka"],
    latitude: 16.5,
    longitude: 79.5,
    bbox: { north: 19.5, south: 13.5, east: 82.5, west: 76.0 },
    riskNote:
      "Dam-release coordination critical; 2020 Hyderabad floods reference.",
    keyCities: ["hyderabad", "visakhapatnam"],
    placeNames: [
      { name: "HYDERABAD", row: 6, col: 5, type: "city" },
      { name: "VIJAYAWADA", row: 8, col: 10, type: "city" },
      { name: "GUNTUR", row: 9, col: 10, type: "city" },
      { name: "WARANGAL", row: 4, col: 6, type: "city" },
      { name: "GODAVARI R.", row: 5, col: 8, type: "river" },
      { name: "KRISHNA R.", row: 9, col: 9, type: "river" },
      { name: "NAGARJUNA SAGAR", row: 7, col: 8, type: "landmark" },
      { name: "NALSAGAR", row: 4, col: 4, type: "landmark" },
      { name: "KHAMMAM", row: 6, col: 8, type: "district" },
    ],
  },
  {
    id: "gujarat-coastal",
    name: "Gujarat Coastal",
    states: ["Gujarat"],
    latitude: 22.0,
    longitude: 72.0,
    bbox: { north: 24.0, south: 20.0, east: 74.0, west: 69.0 },
    riskNote:
      "Cyclone landfall corridor; Tapi / Sabarmati floodplain inundation.",
    keyCities: ["surat", "ahmedabad"],
    placeNames: [
      { name: "SURAT", row: 8, col: 5, type: "city" },
      { name: "AHMEDABAD", row: 3, col: 6, type: "city" },
      { name: "BHARUCH", row: 6, col: 5, type: "city" },
      { name: "TAPI R.", row: 9, col: 5, type: "river" },
      { name: "NARMADA R.", row: 5, col: 5, type: "river" },
      { name: "SABARMATI", row: 4, col: 7, type: "river" },
      { name: "ANAND", row: 5, col: 8, type: "district" },
      { name: "BHAVNAGAR", row: 9, col: 8, type: "district" },
      { name: "GULF OF KHAMBAT", row: 10, col: 6, type: "landmark" },
    ],
  },
  {
    id: "kerala-western-ghats",
    name: "Kerala Western Ghats",
    states: ["Kerala"],
    latitude: 10.0,
    longitude: 76.5,
    bbox: { north: 12.5, south: 8.0, east: 78.0, west: 75.0 },
    riskNote:
      "2018 floods reference. Landslide + flash-flood combination risk.",
    keyCities: ["kochi"],
    placeNames: [
      { name: "KOCHI", row: 5, col: 8, type: "city" },
      { name: "THRISSUR", row: 4, col: 6, type: "city" },
      { name: "ALUVA", row: 5, col: 7, type: "city" },
      { name: "PERIYAR R.", row: 5, col: 7, type: "river" },
      { name: "MUVATTUPUZHA", row: 6, col: 9, type: "river" },
      { name: "IDUKKI", row: 8, col: 8, type: "district" },
      { name: "ERNAKULAM", row: 5, col: 8, type: "district" },
      { name: "WAYANAD", row: 2, col: 5, type: "district" },
      { name: "MUNNAR", row: 9, col: 7, type: "landmark" },
    ],
  },
];

export function getRegionById(id: string): IndiaRegion | undefined {
  return INDIA_FLOOD_REGIONS.find((r) => r.id === id);
}

export function findRegionContaining(
  latitude: number,
  longitude: number,
): IndiaRegion | undefined {
  return INDIA_FLOOD_REGIONS.find((r) => {
    const b = r.bbox;
    return (
      latitude >= b.south &&
      latitude <= b.north &&
      longitude >= b.west &&
      longitude <= b.east
    );
  });
}

export default INDIA_FLOOD_REGIONS;
