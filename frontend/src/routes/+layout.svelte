<script lang="ts">
  import { Toaster } from "svelte-french-toast";
  import "./../app.css";
</script>

<Toaster
  position="top-right"
  toastOptions={{
    duration: 2500,
  }}
/>
<slot />
