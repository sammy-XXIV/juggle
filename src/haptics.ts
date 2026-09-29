const supported = typeof navigator !== "undefined" && "vibrate" in navigator;

const vibrate = (pattern: number | number[]) => {
  if (supported) navigator.vibrate(pattern);
};

export const Haptics = {
  tap: ()    => vibrate(15),           // button press
  lane: ()   => vibrate(30),           // lane switch
  coin: ()   => vibrate([20, 15, 20]), // double tap on coin
  round: ()  => vibrate(60),           // 20s timer fires
  die: ()    => vibrate(250),          // hit a candle
  cashOut: () => vibrate([80, 40, 80]),// cash out
};
