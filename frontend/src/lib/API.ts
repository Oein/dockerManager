// dockerManagerClient.ts

/**
 * Project data interface
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  gitURL: string;
  dockerScript: string;
  dockerFrom: string;
  startCommand: string;
  containerIP: string | null;
  containerID: string | null;
  forceIP: string;
  containerImageID: string | null;
  containerExportPort: string;
  requirePasskeyAuth: boolean;
  allocDomain: string;
}

export interface ContainerInfo {
  gitHash: string;
  buildID: string;
}

/**
 * Project creation payload
 */
export interface CreateProjectPayload {
  name: string;
  description?: string;
  gitURL: string;
  dockerScript: string;
  dockerFrom: string;
  startCommand: string;
  exposePort: string;
  requirePasskeyAuth: boolean;
  allocDomain: string;
}

/**
 * API response types
 */
export interface CreateResponse {
  id: string;
  build: string;
}

export interface RebuildResponse {
  id: string;
  build: string;
}

export interface DeleteResponse {
  success: boolean;
  id: string;
}

export interface UpdateResponse {
  success: boolean;
}

export interface StatusResponse {
  status: string;
}

export interface LogsResponse {
  logs: string;
}

/**
 * Events log response type
 */
export interface EventsLogResponse {
  logs: [string, number][];
}

export interface ApiError {
  error: string;
}

/**
 * Docker Manager API Client
 */
export class DockerManagerClient {
  private baseUrl: string;

  /**
   * Creates a new Docker Manager API client
   *
   * @param baseUrl - Base URL of the Docker Manager API (e.g., "http://localhost:10900")
   */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  }

  /**
   * Get all project IDs
   */
  async listProjects(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/projects/list`);
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to list projects: ${response.statusText}`
      );
    }
    return response.json();
  }

  /**
   * Get details for a specific project
   *
   * @param id - Project ID
   */
  async getProject(id: string): Promise<Project> {
    const response = await fetch(`${this.baseUrl}/api/projects/${id}`);
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to get project: ${response.statusText}`
      );
    }
    return response.json();
  }

  /**
   * Create a new project
   *
   * @param project - Project creation data
   */
  async createProject(project: CreateProjectPayload): Promise<CreateResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(project),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to create project: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Update an existing project
   *
   * @param id - Project ID
   * @param project - Updated project data
   */
  async updateProject(
    id: string,
    project: CreateProjectPayload
  ): Promise<UpdateResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/update/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(project),
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to update project: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Trigger a rebuild for a project
   *
   * @param id - Project ID
   */
  async rebuildProject(id: string): Promise<RebuildResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/rebuild/${id}`, {
      method: "POST",
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to rebuild project: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Delete a project
   *
   * @param id - Project ID
   */
  async deleteProject(id: string): Promise<DeleteResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/delete/${id}`, {
      method: "POST",
    });

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to delete project: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get the status of a project
   *
   * @param id - Project ID
   */
  async getProjectStatus(id: string): Promise<StatusResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/status/${id}`);

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to get project status: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Start a project container
   *
   * @param id - Project ID
   */
  async startProject(id: string): Promise<UpdateResponse> {
    const response = await fetch(`${this.baseUrl}/api/projects/start/${id}`);

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to start project: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get logs for a project
   *
   * @param id - Project ID
   * @param options - Optional parameters for log retrieval
   */
  async getProjectLogs(
    id: string,
    options?: { since?: string; until?: string }
  ): Promise<LogsResponse> {
    let url = `${this.baseUrl}/api/projects/logs/${id}`;

    if (options) {
      const params = new URLSearchParams();
      if (options.since) params.append("since", options.since);
      if (options.until) params.append("until", options.until);

      if (params.toString()) {
        url += `?${params.toString()}`;
      }
    }

    const response = await fetch(url);

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to get project logs: ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Get events log for a project
   *
   * @param id - Project ID
   * @param options - Optional parameters for log retrieval
   */
  async getEventsLog(
    id: string,
    options?: { since?: number; until?: number }
  ): Promise<EventsLogResponse> {
    let url = `${this.baseUrl}/api/projects/events/${id}`;

    if (options) {
      const params = new URLSearchParams();
      if (options.since) params.append("since", options.since.toString());
      if (options.until) params.append("until", options.until.toString());

      if (params.toString()) {
        url += `?${params.toString()}`;
      }
    }

    const response = await fetch(url);

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to get events log: ${response.statusText}`
      );
    }

    return response.json();
  }

  async getContainerInfo(id: string): Promise<ContainerInfo> {
    const response = await fetch(
      `${this.baseUrl}/api/projects/container/${id}`
    );

    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(
        error.error || `Failed to get container info: ${response.statusText}`
      );
    }

    return response.json();
  }
}

const client = new DockerManagerClient(import.meta.env.VITE_API_URL || "/api");
export default client;
