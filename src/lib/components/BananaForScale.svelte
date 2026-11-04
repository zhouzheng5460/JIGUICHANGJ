<!--
  BananaForScale Component
  A silly easter egg that draws an accurately-scaled banana
  next to the rack for visual scale reference.

  Scale: 1U = 1.75" = 22px, so 1" ≈ 12.57px
  Average banana: ~7" long
-->
<script lang="ts">
  import { U_HEIGHT_PX } from "$lib/constants/layout";

  const PIXELS_PER_INCH = U_HEIGHT_PX / 1.75;
  const BANANA_LENGTH_INCHES = 7;
  const bananaLength = Math.round(BANANA_LENGTH_INCHES * PIXELS_PER_INCH);
</script>

<svg
  class="banana-for-scale"
  width={bananaLength}
  height={bananaLength}
  viewBox="0 0 1024 1024"
  aria-label="Banana for scale (approximately 7 inches)"
  role="img"
>
  <title>Banana for scale (7 inches)</title>

  <!-- Main banana body -->
  <path
    d="M 746.667 937.962 C 768 937.962 896 959.295 896 767.295 C 896 575.295 618.667 233.962 234.667 233.962 C 192 233.962 149.333 255.295 149.333 255.295 L 128 319.295 C 128 319.295 149.333 404.628 277.333 468.628 C 405.333 532.628 496.277 586.26 550.677 640.639 C 593.344 683.284 661.333 767.295 661.333 831.295 C 661.333 873.066 704 916.628 704 916.628"
    fill="#FFE082"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, 0, 0.000004)"
  />

  <!-- Darker shading -->
  <path
    d="M 149.333 297.962 C 149.333 297.962 298.667 340.628 426.667 404.628 C 554.667 468.628 832 660.628 746.667 937.962 C 746.667 937.962 874.667 959.295 874.667 767.295 C 874.667 575.295 597.333 233.962 213.333 233.962 C 170.667 233.962 128 255.295 128 255.295 L 149.333 297.962 Z"
    fill="#FFCA28"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, 0.000026, 0.000004)"
  />

  <!-- Green stem -->
  <path
    d="M 384 145.323 C 344 231.104 254.656 186.667 254.656 357.333 C 190.656 357.333 147.989 314.667 147.989 314.667 C 147.989 314.667 211.989 250.667 211.989 186.667 C 254.656 186.667 289.045 190.016 292.864 85.333 C 321.707 207.552 384 145.323 384 145.323 Z"
    fill="#C0CA33"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, -0.000001, 0)"
  />

  <!-- Stem detail -->
  <path
    d="M 234.01 248.753 C 234.01 248.753 232.666 287.43 276.676 334.086 C 320.687 380.742 362.671 342.748 362.671 342.748 L 357.551 232.753 C 357.551 232.753 338.884 302.086 309.551 303.857 C 247.684 307.59 234.01 248.753 234.01 248.753 Z"
    fill="#C0CA33"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, -0.000007, -0.00001)"
  />

  <!-- Brown tip -->
  <path
    d="M 853.333 896 L 874.667 853.333 L 896 853.333 L 896 896 L 853.333 917.333 L 853.333 896 Z"
    fill="#5D4037"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, 0.000001, -0.000026)"
  />

  <!-- Dark stem top -->
  <path
    d="M 384 128 C 320 128 277.333 85.333 277.333 85.333 L 341.333 85.333 L 384 128 L 384 128 Z"
    fill="#827717"
    style="transform-box: fill-box; transform-origin: 50% 50%;"
    transform="matrix(-1, 0, 0, -1, 0.000006, 0.000001)"
  />
</svg>

<style>
  .banana-for-scale {
    pointer-events: none;
    filter: drop-shadow(1px 2px 2px rgba(0, 0, 0, 0.3));
  }
</style>
