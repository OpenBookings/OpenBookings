const backgrounds = [
  {
    id: 1,
    name: "Sydney",
    image_path: "Australia-Sydney.avif",
  },
  {
    id: 2,
    name: "Paris",
    image_path: "France-Paris.avif",
  },
  {
    id: 3,
    name: "Honolulu",
    image_path: "Hawaii-Honolulu.avif",
  },
  {
    id: 4,
    name: "Iceland",
    image_path: "Iceland-Reykjavik.avif",
  },
  {
    id: 5,
    name: "Rome",
    image_path: "Italy-Rome.avif",
  },
  {
    id: 6,
    name: "Osaka",
    image_path: "Japan-Osaka.avif",
  },
  {
    id: 7,
    name: "Morroco",
    image_path: "Morroco-Chefchaouen.avif",
  },
  {
    id: 8,
    name: "Amsterdam",
    image_path: "Netherlands-Amsterdam.avif",
  },
  {
    id: 9,
    name: "San Francisco",
    image_path: "USA-SanFrancisco.avif",
  },
];

// URL builder for background images
export const getBackgroundImageUrl = (image_path: string) => {
  return `https://storage.googleapis.com/openbookings-backgrounds/${image_path}`;
};

// Random background image picker
export const getRandomBackgroundImage = () => {
  const randomIndex = Math.floor(Math.random() * backgrounds.length);
  const backgroundURL = getBackgroundImageUrl(backgrounds[randomIndex].image_path);
  const backgroundName = backgrounds[randomIndex].name;
  return {
    url: backgroundURL,
    name: backgroundName,
  };
};