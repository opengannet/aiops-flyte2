# Development Instances Design

## Goal

Add a Flyte Console "开发实例" feature for creating and managing SSH-accessible development pods backed by the existing `ssh_workspace` task plugin.

## User Experience

The project-scoped left navigation gains a "开发实例" item that links to `/domain/:domain/project/:project/development-instances`.

The list page follows the provided screenshots for information structure while using the existing Flyte Console visual system. It shows:

- Name
- Description
- Resource spec
- Status
- Owner
- Created time
- SSH command when available

The list page supports search, refresh, row selection, start, stop, delete, and create actions. "Create" opens a project-scoped create page at `/domain/:domain/project/:project/development-instances/create`.

The create page contains:

- Basic info: name, description, owner, resource spec, max usage hours
- Image selection: official image or custom image
- SSH public key input
- Auto-assigned NodePort preview

## Backend Behavior

Creation uses `RunService.CreateRun` with a `TaskSpec` whose `taskTemplate.type` is `ssh_workspace`. The task custom payload includes:

- `image`
- `sshUser`
- `authorizedKeys`
- `workspaceSize`
- `serviceType: NodePort`
- `nodePort`
- optional `cpu`, `memory`, and `environment`

Stopping uses `RunService.AbortRun`.

Deleting a development instance is a real Kubernetes cleanup, not only a UI hide. Delete behavior:

- Abort the Flyte run when it still exists.
- Delete Kubernetes workload resources for the workspace.
- Delete `Secret`, `Service`, and `Ingress` resources for the workspace.
- Keep the PVC and `/workspace` data.

The existing plugin already deletes StatefulSet, Service, and Secret during abort and retains PVC. It will be extended to delete Ingress resources with matching workspace labels. The Console delete action will also call a server-side cleanup route so deletion is explicit from the UI even if the Flyte abort reconciler is delayed.

## NodePort Allocation

The frontend auto-assigns a default NodePort in the Kubernetes NodePort range. It scans currently listed development instances for existing `nodePort` values in task custom payloads, then chooses the first free port from the configured range.

Default range:

- Start: `31000`
- End: `32767`

If the generated port conflicts at Kubernetes create time, the create request surfaces the backend error and the user can refresh/retry.

## Connection Info

The SSH command is derived from task custom data:

```text
ssh -p <nodePort> <sshUser>@172.19.66.218
```

The host defaults to the current deployment node host from project instructions. The UI exposes copy actions for the SSH command.

## Data Model

Development instances are represented by Flyte runs whose root task is `ssh_workspace`. The UI maps run details and action spec data into an instance row. There is no separate database table.

Run context labels are used to carry display metadata:

- `aione.devInstanceName`
- `aione.devInstanceDescription`
- `aione.devInstanceOwner`
- `aione.devInstanceDeleted` when the UI has explicitly deleted the instance

## Testing

Backend:

- Plugin abort deletes Ingress resources.
- Plugin abort still retains PVC.

Frontend:

- NodePort allocation skips ports already present on listed instances.
- Task payload builder produces a valid `ssh_workspace` `CreateRunRequest`.
- Instance mapper extracts name, status, owner, resource spec, SSH command, and deleted marker.

Verification:

- Go unit tests for `flyteplugins/aione/sshworkspace`.
- Frontend unit tests for the development instance utilities.
- Production console build.
- Remote backend rebuild/chart update and frontend service update.
- Playwright verification of list/create pages and screenshot capture.
