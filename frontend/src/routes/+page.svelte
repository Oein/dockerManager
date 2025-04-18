<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import client, { type Project } from "../lib/API";

  let projects: (Project & { status?: string })[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      // Get all project IDs
      const projectIds = await client.listProjects();

      // Fetch details for each project
      const projectDetails = await Promise.all(
        projectIds.map((id) => client.getProject(id))
      );

      // Get status for each project
      const projectsWithStatus = await Promise.all(
        projectDetails.map(async (project) => {
          try {
            const statusData = await client.getProjectStatus(project.id);
            return { ...project, status: statusData.status };
          } catch (err) {
            return { ...project, status: "unknown" };
          }
        })
      );

      projects = projectsWithStatus;
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      error = "Failed to load containers. Please try again later.";
    } finally {
      loading = false;
    }
  });

  const handleContainerClick = (projectId: string) => {
    goto(`/projects/${projectId}`);
  };

  function getStatusStyle(status: string): string {
    switch (status.toLowerCase()) {
      case "running":
        return "bg-green-100 text-green-800";
      case "stopped":
        return "bg-red-100 text-red-800";
      case "building":
        return "bg-blue-100 text-blue-800";
      default:
        return "bg-yellow-100 text-yellow-800";
    }
  }
</script>

<div class="container mx-auto p-4">
  <div class="flex justify-between items-center mb-8">
    <h1 class="text-3xl font-bold">Docker Manager</h1>
    <a
      href="/new"
      class="bg-blue-600 text-white py-2 px-4 rounded font-bold hover:bg-blue-700 transition-colors"
    >
      + New
    </a>
  </div>

  {#if loading}
    <div class="text-center py-8 text-gray-600">
      <p>Loading containers...</p>
    </div>
  {:else if error}
    <div class="text-center py-8 text-red-600">
      <p>{error}</p>
    </div>
  {:else if projects.length === 0}
    <div class="text-center py-8 text-gray-600">
      <p>No containers found. Create a new service to get started.</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      {#each projects as project}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
          on:click={() => handleContainerClick(project.id)}
        >
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-bold">{project.name}</h3>
            <span
              class="px-3 py-1 rounded-full text-sm font-medium {getStatusStyle(
                project.status || 'unknown'
              )}"
            >
              {project.status || "Unknown"}
            </span>
          </div>

          <div class="text-sm text-gray-600">
            {#if project.description}
              <p class="mb-2">{project.description}</p>
            {/if}
            <p class="mb-1">Domain: {project.allocDomain}</p>
            <p class="mb-1">
              Container ID: {project.containerID || "Not running"}
            </p>
            <p>Port: {project.containerExportPort}</p>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* You can add any additional custom styles here */
</style>
