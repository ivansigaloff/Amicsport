export const getVenueImage = (venueName: string | undefined, fallbackUrl: string | undefined) => {
  if (!venueName) return fallbackUrl ? { uri: fallbackUrl } : require('../assets/images/venues/satalia.png');
  
  const v = venueName.toLowerCase();
  
  if (v.includes('satalia')) {
    return require('../assets/images/venues/satalia.png');
  }
  if (v.includes('iberia')) {
    return require('../assets/images/venues/iberia.png');
  }
  if (v.includes('escuela industrial') || v.includes('escuela')) {
    return require('../assets/images/venues/escuela_industrial.png');
  }
  if (v.includes('agapito')) {
    return require('../assets/images/venues/agapito.png');
  }
  
  return fallbackUrl ? { uri: fallbackUrl } : require('../assets/images/venues/satalia.png');
};
