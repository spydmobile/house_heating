import path from 'path';

export const config = {
  port: process.env.PORT || 3001,
  dbPath: path.join(__dirname, '../../data/fuel_tracker.db'),

  // Tank settings
  tankCapacity: 1000, // liters

  // Cost settings
  discountPerLiter: 0.02, // 2 cents
  gstRate: 0.05, // 5%

  // Weather settings
  hddBaseTemp: 18, // Celsius
  weatherStation: 'ZSM', // Fort Smith station ID

  // MSC Datamart base URL
  mscDatamartUrl: 'https://dd.weather.gc.ca',
};
