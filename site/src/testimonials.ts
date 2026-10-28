export type Testimonial = {
  /** Original wording (Indonesian), trimmed with "…" only. */
  quote: string;
  /** Threads handle without the @. */
  handle: string;
  /** Public comment URL. */
  url: string;
};

export const TESTIMONIALS: readonly Testimonial[] = [
  {
    quote: "mantapp ini yang saya perlu",
    handle: "manehteh_",
    url: "https://www.threads.com/@manehteh_/post/Deg41vyGEsc",
  },
  {
    quote: "Keren pak dibuat live…",
    handle: "pepperparker8",
    url: "https://www.threads.com/@pepperparker8/post/DehE7rhE_rD",
  },
  {
    quote: "Gila pack effortnya",
    handle: "dorobryakov",
    url: "https://www.threads.com/@dorobryakov/post/Deic1zojyQh",
  },
  {
    quote: "…ide menarik, good job bro",
    handle: "michael.dukakis",
    url: "https://www.threads.com/@michael.dukakis/post/DehCirhmEFd",
  },
  {
    quote: "Keren mas, otw coba.",
    handle: "andrealifridho",
    url: "https://www.threads.com/@andrealifridho/post/DeiuUfynywc",
  },
  {
    quote: "GOAT.",
    handle: "aldorino.yan",
    url: "https://www.threads.com/@aldorino.yan/post/Deik60GgZcY",
  },
];
