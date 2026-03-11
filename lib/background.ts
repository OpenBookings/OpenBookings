import backgrounds from "./backgrounds.json" assert { type: "json" };

type Background = {
  image_path: string;
  name: string;
};
// URL builder for background images
const getBackgroundImageUrl = (image_path: string) => {
  return `https://images.openbookings.co/${image_path}`;
};

// Random background image picker
export const getRandomBackgroundImage = () => {
  const randomIndex = Math.floor(Math.random() * (backgrounds as Background[]).length);
  const backgroundURL = getBackgroundImageUrl((backgrounds as Background[])[randomIndex].image_path);
  const backgroundName = (backgrounds as Background[])[randomIndex].name;
  return {
    url: backgroundURL,
    name: backgroundName,
  };
};