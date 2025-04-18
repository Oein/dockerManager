<script lang="ts">
  import { goto } from "$app/navigation";
  import client, { type CreateProjectPayload } from "../../lib/API";

  let form: CreateProjectPayload = {
    name: "",
    description: "",
    gitURL: "",
    dockerScript: "RUN bun install\nRUN bun build",
    dockerFrom: "oven/bun",
    startCommand: "bun run start",
    exposePort: "3000",
    requirePasskeyAuth: false,
    allocDomain: "",
  };

  let selectedAllocDomain = ".ert.im";

  let loading = false;
  let error: string | null = null;

  const handleSubmit = async () => {
    loading = true;
    error = null;

    try {
      const response = await client.createProject({
        ...form,
        allocDomain: form.allocDomain
          ? form.allocDomain + selectedAllocDomain
          : "",
      });
      goto(`/projects/${response.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      error = "Failed to create the container. Please try again.";
    } finally {
      loading = false;
    }
  };
</script>

<div class="container p-4">
  <h1 class="text-3xl font-bold mb-6">Create New Container</h1>

  {#if error}
    <div class="text-red-600 mb-4">{error}</div>
  {/if}

  <form on:submit|preventDefault={handleSubmit} class="grid grid-cols-1 gap-4">
    <div class="flex items-center gap-4">
      <label for="name" class="font-bold w-1/3 text-right">Name</label>
      <input
        id="name"
        type="text"
        bind:value={form.name}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
    </div>

    <div class="flex items-center gap-4">
      <label for="description" class="font-bold w-1/3 text-right"
        >Description</label
      >
      <textarea
        id="description"
        bind:value={form.description}
        class="flex-grow border border-gray-300 rounded p-2"
      ></textarea>
    </div>

    <div class="flex items-center gap-4">
      <label for="gitURL" class="font-bold w-1/3 text-right">Git URL</label>
      <input
        id="gitURL"
        bind:value={form.gitURL}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
    </div>

    <div class="flex items-center gap-4">
      <label for="dockerFrom" class="font-bold w-1/3 text-right"
        >Docker From</label
      >
      <input
        id="dockerFrom"
        type="text"
        bind:value={form.dockerFrom}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
    </div>

    <div class="flex items-center gap-4 mt-4">
      <label for="dockerScript" class="font-bold w-1/3 text-right"
        >Docker Script</label
      >
      <textarea
        id="dockerScript"
        bind:value={form.dockerScript}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      ></textarea>
    </div>

    <div class="flex items-center gap-4 mt-4">
      <label for="startCommand" class="font-bold w-1/3 text-right"
        >Start Command</label
      >
      <input
        id="startCommand"
        type="text"
        bind:value={form.startCommand}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
    </div>

    <div class="flex items-center gap-4">
      <label for="exposePort" class="font-bold w-1/3 text-right"
        >Expose Port</label
      >
      <input
        id="exposePort"
        type="text"
        bind:value={form.exposePort}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
    </div>

    <div class="flex items-center gap-4">
      <label for="allocDomain" class="font-bold w-1/3 text-right"
        >Allocated Domain</label
      >
      <input
        id="allocDomain"
        type="text"
        bind:value={form.allocDomain}
        class="flex-grow border border-gray-300 rounded p-2"
        required
      />
      <select
        bind:value={selectedAllocDomain}
        class="border border-gray-300 rounded p-2 bg-transparent"
      >
        <option value=".ert.im">ert.im</option>
      </select>
    </div>

    <div class="flex items-center gap-4">
      <label for="requirePasskeyAuth" class="font-bold w-1/3 text-right"
        >Passkey Auth</label
      >
      <input
        id="requirePasskeyAuth"
        type="checkbox"
        bind:checked={form.requirePasskeyAuth}
        class="mr-2"
      />
    </div>

    <div class="flex justify-end">
      <button
        type="submit"
        class="bg-blue-600 text-white py-2 px-4 rounded font-bold hover:bg-blue-700 transition-colors"
        disabled={loading}
      >
        {loading ? "Creating..." : "Create"}
      </button>
    </div>
  </form>
</div>
