import backgrounds from "./backgrounds.json" assert { type: "json" };

type Background = {
  image_path: string;
  name: string;
  "gradient-a": string;
  "gradient-b": string;
};
// URL builder for background images
export const getBackgroundImageUrl = (image_path: string) => {
  return `https://storage.googleapis.com/openbookings-backgrounds/${image_path}`;
};

// Random background image picker
export const getRandomBackgroundImage = () => {
  const randomIndex = Math.floor(Math.random() * (backgrounds as Background[]).length);
  const backgroundURL = getBackgroundImageUrl((backgrounds as Background[])[randomIndex].image_path);
  const backgroundName = (backgrounds as Background[])[randomIndex].name;
  const gradientA = (backgrounds as Background[])[randomIndex]["gradient-a"];
  const gradientB = (backgrounds as Background[])[randomIndex]["gradient-b"];
  return {
    url: backgroundURL,
    name: backgroundName,
    gradientA: gradientA,
    gradientB: gradientB,
  };
};