<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import client, { type ContainerInfo, type Project } from "../../../lib/API";
  import { toast } from "svelte-french-toast";

  let project: Project | null = null;
  let loading = true;
  let error: string | null = null;
  let editingTitle = false;
  let editingDescription = false;
  let editingFields: { [key: string]: boolean } = {};
  let inputRefs: {
    [key: string]:
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
  } = {};

  $: id = $page.params.id;

  let activeTab = "Logs";
  let logs: string[] = [];
  let buildLogs: [string, number][] = [];
  let containerInfo: ContainerInfo | null = null;

  let lastTimestamp_log: string | null = null;
  let firstTimestamp_log: string | null = null;

  let lastTimestamp_build_log: number | null = null;
  let firstTimestamp_build_log: number | null = null;

  let logsInterval: number | null = null;
  let buildLogsInterval: number | null = null;

  let autoScrollLogs = true;
  let autoScrollBuildLogs = true;
  let logsContainer: HTMLDivElement | null = null;
  let buildLogsContainer: HTMLDivElement | null = null;
  let logsEndRef: HTMLDivElement | null = null;
  let buildLogsEndRef: HTMLDivElement | null = null;

  function switchTab(tab: string) {
    activeTab = tab;
  }

  async function updateProject(field: keyof Project, value: string | boolean) {
    if (project) {
      try {
        project = { ...project, [field]: value };
        await client.updateProject(id, project as any);
        toast.success(`${field} updated successfully!`);
      } catch (err) {
        console.error(`Failed to update ${field}:`, err);
        toast.error(`Failed to update ${field}. Please try again.`);
      }
    }
  }

  async function toggleEdit(field: keyof Project) {
    editingFields[field] = !editingFields[field];
    // await for input to be defined
    const res = await new Promise<boolean>((resolve) => {
      let tryied = 0;
      const inter = setInterval(() => {
        if (inputRefs[field]) {
          clearInterval(inter);
          resolve(true);
          return;
        }
        tryied++;
        if (tryied > 100) {
          clearInterval(inter);
          resolve(false);
        }
      }, 10);
    });
    if (res && editingFields[field] && inputRefs[field]) {
      inputRefs[field]?.focus();
    }
  }

  let ftchFirst = true;
  async function fetchLogs() {
    try {
      logs = (await client.getProjectLogs(id)).logs
        .split("\n")
        .filter((x) => !!x);

      if (logs.length > 0) {
        firstTimestamp_log = logs[0].split("Z")[0] + "Z";
        lastTimestamp_log = logs[logs.length - 1].split("Z")[0] + "Z";

        console.log(
          "First log timestamp:",
          firstTimestamp_log,
          "Last log timestamp:",
          lastTimestamp_log
        );
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      toast.error("Failed to fetch logs.");
    } finally {
      ftchFirst = false;
    }
  }

  let ftchFirst_build_log = true;
  async function fetchBuildLogs() {
    try {
      buildLogs = (await client.getEventsLog(id)).logs;

      if (buildLogs.length > 0) {
        lastTimestamp_build_log = buildLogs[buildLogs.length - 1][1];
        firstTimestamp_build_log = buildLogs[0][1];
      }
    } catch (err) {
      console.error("Failed to fetch build logs:", err);
      toast.error("Failed to fetch build logs.");
    } finally {
      ftchFirst_build_log = false;
    }
  }

  async function fetchContainerInfo() {
    try {
      containerInfo = await client.getContainerInfo(id);
    } catch (err) {
      console.error("Failed to fetch container info:", err);
      toast.error("Failed to fetch container info.");
    }
  }

  let fetchingNL = false;
  async function fetchNewLogs() {
    if (fetchingNL || ftchFirst) return;
    try {
      const newLogs = (
        await client.getProjectLogs(id, {
          since: lastTimestamp_log!,
        })
      ).logs
        .split("\n")
        .filter((x) => !!x && x.split("Z")[0] + "Z" !== lastTimestamp_log);
      if (newLogs.length) {
        logs = [...logs, ...newLogs];
        console.log(newLogs);
        lastTimestamp_log = newLogs[newLogs.length - 1].split("Z")[0] + "Z";

        if (autoScrollLogs && logsEndRef) {
          scrollToBottom(logsEndRef);
        }
      }
    } catch (err) {
      console.error("Failed to fetch new logs:", err);
    } finally {
      fetchingNL = false;
    }
  }

  let fetchingNBL = false;
  async function fetchNewBuildLogs() {
    if (fetchingNBL || ftchFirst_build_log) return;
    fetchingNBL = true;
    try {
      const newBuildLogs = (
        await client.getEventsLog(id, {
          since: lastTimestamp_build_log!,
        })
      ).logs.filter(
        (x) =>
          x[1] !== lastTimestamp_build_log && x[1] > lastTimestamp_build_log!
      );
      if (newBuildLogs.length > 0) {
        buildLogs = [...buildLogs, ...newBuildLogs];
        lastTimestamp_build_log = newBuildLogs[newBuildLogs.length - 1][1];

        if (autoScrollBuildLogs && buildLogsEndRef) {
          scrollToBottom(buildLogsEndRef);
        }
      }
    } catch (err) {
      console.error("Failed to fetch new build logs:", err);
    } finally {
      fetchingNBL = false;
    }
  }
  async function deployContainer() {
    try {
      await client.rebuildProject(id);
      toast.success("Container deployed successfully!");
    } catch (err) {
      console.error("Failed to deploy container:", err);
      toast.error("Failed to deploy container.");
    }
  }

  function scrollToBottom(ref: HTMLDivElement | null) {
    if (ref) {
      ref.scrollIntoView({});
      for (let i = 0; i < 10; i++) {
        setTimeout(() => {
          ref.scrollIntoView({});
        }, 10 * i);
      }
      console.log("Scrolling to bottom", ref);
    }
  }

  $: if (autoScrollLogs && logsEndRef) {
    scrollToBottom(logsEndRef);
  }

  $: if (autoScrollBuildLogs && buildLogsEndRef) {
    scrollToBottom(buildLogsEndRef);
  }

  onMount(() => {
    ftchFirst = true;
    ftchFirst_build_log = true;
    (async () => {
      if (typeof window === "undefined") return;
      try {
        project = await client.getProject(id);
        if (!project) {
          error = "Project not found";
          return;
        }
        fetchLogs();
        fetchBuildLogs();
        fetchContainerInfo();
      } catch (err) {
        console.error("Failed to fetch project:", err);
        error = "Failed to load project. Please try again later.";
      } finally {
        loading = false;
      }
    })();

    logsInterval = setInterval(fetchNewLogs, 1000); // Fetch logs every 5 seconds
    buildLogsInterval = setInterval(fetchNewBuildLogs, 1000); // Fetch build logs every 5 seconds

    return () => {
      if (logsInterval) clearInterval(logsInterval);
      if (buildLogsInterval) clearInterval(buildLogsInterval);
    };
  });

  onDestroy(() => {
    if (logsInterval) clearInterval(logsInterval);
    if (buildLogsInterval) clearInterval(buildLogsInterval);
  });
</script>

<div class="container mx-auto p-4">
  {#if loading}
    <div class="text-center py-8 text-gray-600">
      <p>Loading project...</p>
    </div>
  {:else if error}
    <div class="text-center py-8 text-red-600">
      <p>{error}</p>
    </div>
  {:else if project}
    <div>
      <div class="flex items-center mb-2">
        <button
          class="mr-4 text-blue-500 hover:underline mt-1"
          on:click={() => goto("/")}
        >
          ←
        </button>
        {#if editingTitle}
          <input
            type="text"
            class="border rounded p-1 flex-grow"
            bind:this={inputRefs.name}
            bind:value={project.name}
            on:blur={() => {
              editingTitle = false;
              updateProject("name", project?.name || "Unnamed Project");
            }}
          />
        {:else}
          <h1 class="text-3xl font-bold mb-0 flex-grow">{project.name}</h1>
          <button
            class="ml-2 text-gray-500 hover:text-gray-700"
            on:click={() => {
              editingTitle = true;
              inputRefs.name?.focus();
            }}
          >
            ✏️
          </button>
        {/if}
      </div>
      <div class="flex items-center mb-4">
        {#if editingDescription}
          <textarea
            class="border rounded p-1 flex-grow"
            bind:this={inputRefs.description}
            bind:value={project.description}
            on:blur={() => {
              editingDescription = false;
              updateProject("description", project?.description || "");
            }}
          ></textarea>
        {:else}
          <p class="text-gray-600 flex-grow">
            {project.description || "No description provided."}
          </p>
          <button
            class="ml-2 text-gray-500 hover:text-gray-700"
            on:click={() => {
              editingDescription = true;
              inputRefs.description?.focus();
            }}
          >
            ✏️
          </button>
        {/if}
      </div>

      <!-- Container Info Section -->
      <details class="border rounded shadow p-2 mb-4">
        <summary class="text-lg font-semibold cursor-pointer">
          Container Info
        </summary>
        <div class="mt-2">
          {#if containerInfo}
            <p><strong>Git Hash:</strong> {containerInfo.gitHash}</p>
            <p><strong>Build ID:</strong> {containerInfo.buildID}</p>
          {:else}
            <p>Loading container info...</p>
          {/if}
          {#if project}
            <p><strong>Alloc IP:</strong> {project.containerIP}</p>
            <p><strong>Container ID:</strong> {project.containerID}</p>
            <p><strong>Image ID:</strong> {project.containerImageID}</p>
          {:else}
            <p>Loading container info...</p>
          {/if}
        </div>
      </details>

      <details class="border rounded shadow p-2">
        <summary class="text-lg font-semibold cursor-pointer">
          Build options
        </summary>
        <div class="mt-2">
          <div class="flex items-center mb-2">
            {#if editingFields.gitURL}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.gitURL}
                bind:value={project.gitURL}
                on:blur={() => {
                  toggleEdit("gitURL");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("gitURL", project.gitURL);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Git URL:</strong>
                {project.gitURL}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("gitURL")}
              >
                ✏️
              </button>
            {/if}
          </div>
          <div class="flex items-center mb-2">
            {#if editingFields.dockerFrom}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.dockerFrom}
                bind:value={project.dockerFrom}
                on:blur={() => {
                  toggleEdit("dockerFrom");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("dockerFrom", project.dockerFrom);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Docker From:</strong>
                {project.dockerFrom}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("dockerFrom")}
              >
                ✏️
              </button>
            {/if}
          </div>
          <div class="flex items-center mb-2">
            {#if editingFields.startCommand}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.startCommand}
                bind:value={project.startCommand}
                on:blur={() => {
                  toggleEdit("startCommand");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("startCommand", project.startCommand);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Start Command:</strong>
                {project.startCommand}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("startCommand")}
              >
                ✏️
              </button>
            {/if}
          </div>
          <div class="flex items-center mb-2">
            {#if editingFields.allocDomain}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.allocDomain}
                bind:value={project.allocDomain}
                on:blur={() => {
                  toggleEdit("allocDomain");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("allocDomain", project.allocDomain);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Allocated Domain:</strong>
                {project.allocDomain}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("allocDomain")}
              >
                ✏️
              </button>
            {/if}
          </div>

          <div class="flex items-center mb-2">
            {#if editingFields.dockerFrom}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.dockerFrom}
                bind:value={project.dockerFrom}
                on:blur={() => {
                  toggleEdit("dockerFrom");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("dockerFrom", project.dockerFrom);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Docker From:</strong>
                {project.dockerFrom}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("dockerFrom")}
              >
                ✏️
              </button>
            {/if}
          </div>

          <div class="flex items-center mb-2">
            {#if editingFields.forceIP}
              <input
                type="text"
                class="border rounded p-1 flex-grow"
                bind:this={inputRefs.forceIP}
                bind:value={project.forceIP}
                on:blur={() => {
                  toggleEdit("forceIP");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("forceIP", project.forceIP);
                }}
              />
            {:else}
              <p class="flex-grow">
                <strong>Force IP:</strong>
                {project.forceIP}
              </p>
              <button
                class="ml-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("forceIP")}
              >
                ✏️
              </button>
            {/if}
          </div>
          <div class="flex items-center mb-2">
            <label class="flex items-center">
              <input
                type="checkbox"
                class="mr-2"
                bind:checked={project.requirePasskeyAuth}
                on:change={() => {
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject(
                    "requirePasskeyAuth",
                    project.requirePasskeyAuth
                  );
                }}
              />
              <strong>Require Passkey Auth:</strong>
            </label>
            <p class="ml-2">{project.requirePasskeyAuth ? "Yes" : "No"}</p>
          </div>
          <div class="flex flex-col mb-2">
            <label for="dockerScript" class="font-semibold mb-1">
              Docker Script:
            </label>
            {#if editingFields.dockerScript}
              <textarea
                id="dockerScript"
                class="border rounded p-2 w-full"
                bind:this={inputRefs.dockerScript}
                bind:value={project.dockerScript}
                on:blur={() => {
                  toggleEdit("dockerScript");
                  if (!project) {
                    toast.error("Project not found");
                    return;
                  }
                  updateProject("dockerScript", project.dockerScript);
                }}
              ></textarea>
            {:else}
              <pre
                class="bg-gray-100 p-2 rounded w-full overflow-x-auto">{project.dockerScript ||
                  "No Docker script provided."}</pre>
              <button
                class="mt-2 text-gray-500 hover:text-gray-700"
                on:click={() => toggleEdit("dockerScript")}
              >
                ✏️ Edit Docker Script
              </button>
            {/if}
          </div>
        </div>
      </details>

      <!-- Deploy Button -->
      <div class="my-4">
        <button
          class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          on:click={deployContainer}
        >
          Deploy
        </button>
      </div>

      <div class="mt-4">
        <div class="flex border-b">
          <button
            class="px-4 py-2 -mb-px border-b-2"
            class:font-bold={activeTab === "Logs"}
            class:border-blue-500={activeTab === "Logs"}
            on:click={() => switchTab("Logs")}
          >
            Logs
          </button>
          <button
            class="px-4 py-2 -mb-px border-b-2"
            class:font-bold={activeTab === "Build Logs"}
            class:border-blue-500={activeTab === "Build Logs"}
            on:click={() => switchTab("Build Logs")}
          >
            Build Logs
          </button>
        </div>
        <div class="mt-4">
          {#if activeTab === "Logs"}
            <div class="flex items-center mb-2">
              <label class="flex items-center">
                <input
                  type="checkbox"
                  class="mr-2"
                  bind:checked={autoScrollLogs}
                />
                <span>Auto-scroll</span>
              </label>
            </div>
            <div
              class="bg-black text-white p-4 rounded h-96 overflow-y-auto text-sm scroll-m-4"
              bind:this={logsContainer}
            >
              <pre>{#each logs as log}{log}<br />{/each}</pre>
              <div bind:this={logsEndRef}></div>
            </div>
          {:else if activeTab === "Build Logs"}
            <div class="flex items-center mb-2">
              <label class="flex items-center">
                <input
                  type="checkbox"
                  class="mr-2"
                  bind:checked={autoScrollBuildLogs}
                />
                <span>Auto-scroll</span>
              </label>
            </div>
            <div
              class="bg-black text-white p-4 rounded h-96 overflow-y-auto text-sm scroll-m-4"
              bind:this={buildLogsContainer}
            >
              <pre>{#each buildLogs as [log]}{log}<br />{/each}</pre>
              <div bind:this={buildLogsEndRef}></div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
