const mockVehicleRoutes = [
  {
    vehicleId: 'VEH-001',
    name: 'Atlas-1',
    source: { lat: 13.0676, lng: 80.2374 }, // Chennai Central
    destination: { lat: 13.0102, lng: 80.2209 } // T Nagar
  },
  {
    vehicleId: 'VEH-002',
    name: 'Atlas-2',
    source: { lat: 13.0827, lng: 80.2707 }, // Washermanpet
    destination: { lat: 13.0475, lng: 80.1462 } // Anna Nagar
  },
  {
    vehicleId: 'VEH-003',
    name: 'Atlas-3',
    source: { lat: 12.9879, lng: 80.2455 }, // Adyar
    destination: { lat: 13.0218, lng: 80.1965 } // Koyambedu
  },
  {
    vehicleId: 'VEH-004',
    name: 'Atlas-4',
    source: { lat: 12.9516, lng: 80.1462 }, // Airport side
    destination: { lat: 13.0806, lng: 80.2867 } // Royapuram
  },
  {
    vehicleId: 'VEH-005',
    name: 'Atlas-5',
    source: { lat: 13.0352, lng: 80.2326 }, // Nungambakkam
    destination: { lat: 12.9040, lng: 80.2279 } // Sholinganallur
  }
];

module.exports = { mockVehicleRoutes };
