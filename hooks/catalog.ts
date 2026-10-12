// Pure: the slash-command table (one name per resource), scope shape and edits,
// resource rows, the prompt block and the /foundry context tree.
// Everything that runs orthanc stays in register.tsx, where `$` lives.

import type {
  FoundryNamed,
  FoundryObjectType,
  FoundryPickerKind,
  FoundryResource,
  FoundryResourceKind,
  FoundryScope,
} from '../types'
import { isRecord } from './orthanc'

/** Compass resource kinds orthanc lists with `resource list|search --type`. */
export const COMPASS_KINDS = {
  folders: { label: 'Folders', typeId: 'COMPASS_FOLDER' },
  datasets: { label: 'Datasets', typeId: 'FOUNDRY_DATASET' },
  mediaSets: { label: 'Media sets', typeId: 'MIO_MEDIA_SET' },
  repositories: { label: 'Repositories', typeId: 'STEMMA_REPOSITORY' },
  contourAnalyses: { label: 'Contour analyses', typeId: 'CONTOUR_ANALYSIS' },
  sources: { label: 'Sources', typeId: 'MAGRITTE_SOURCE' },
  developerConsoles: { label: 'Developer Console', typeId: 'THIRD_PARTY_APPLICATIONS_APPLICATION' },
  aipChatbots: { label: 'AIP chatbots', typeId: 'AIP_AGENTS_AGENT' },
} as const
export type CompassKind = keyof typeof COMPASS_KINDS

export const RESOURCE_LABELS: Record<FoundryResourceKind, string> = {
  ...Object.fromEntries(Object.entries(COMPASS_KINDS).map(([kind, def]) => [kind, def.label])),
  mediaItems: 'Media items',
  objectInstances: 'Object instances',
  functions: 'Functions',
  languageModels: 'Language models',
  permissions: 'Permissions',
  searchResults: 'Search results',
} as Record<FoundryResourceKind, string>

/** Resource kinds that belong to the ontology and go when it changes. */
const ONTOLOGY_KINDS: readonly FoundryResourceKind[] = ['objectInstances', 'functions']

export type Lookup = 'media-item' | 'objects' | 'function' | 'language-model' | 'permission' | 'search'

export type CommandAction =
  | { type: 'picker'; kind: Exclude<FoundryPickerKind, 'resource'> }
  | { type: 'resource'; kind: CompassKind }
  | { type: 'lookup'; lookup: Lookup; kind: FoundryResourceKind }
  | { type: 'blocked'; bead: string; what: string }
  | { type: 'open' | 'onboard' | 'auth' | 'scope' | 'approval' | 'mcp-status' | 'foundry' | 'trace' | 'fde' }

export type CommandEntry = { name: string; description: string; argumentHint?: string; action: CommandAction }

const CLEARABLE = '[filter | clear]'
const LINK_BEAD = 'orthanc-ra6'
const LISTING_BEAD = 'orthanc-qm5'
export const OBJECT_QUERY_BEAD = 'orthanc-4f7'

const picker = (name: string, kind: Exclude<FoundryPickerKind, 'resource'>, description: string): CommandEntry => ({
  name,
  description,
  argumentHint: kind === 'profile' ? '[name]' : CLEARABLE,
  action: { type: 'picker', kind },
})
const resource = (name: string, kind: CompassKind): CommandEntry => ({
  name,
  description: `Choose ${COMPASS_KINDS[kind].label.toLowerCase()} in scope`,
  argumentHint: CLEARABLE,
  action: { type: 'resource', kind },
})
const blocked = (name: string, what: string, bead: string): CommandEntry =>
  ({ name, description: `Choose ${what} (waits on orthanc ${bead})`, action: { type: 'blocked', bead, what } })

export const COMMAND_TABLE: readonly CommandEntry[] = [
  { name: 'foundry', description: 'Show the Foundry resources in context (like /context, for Palantir)', action: { type: 'foundry' } },
  { name: 'open', description: 'Set working context: stack, then ontology and projects', action: { type: 'open' } },
  { name: 'onboard', description: 'Check Foundry setup: orthanc, stack, credentials, context', action: { type: 'onboard' } },
  { name: 'auth', description: 'Show how to authenticate a Foundry stack', argumentHint: '[profile]', action: { type: 'auth' } },
  picker('profile', 'profile', 'Choose the Foundry stack (orthanc profile)'),
  picker('ontology', 'ontology', 'Choose the active Foundry ontology'),
  picker('project', 'project', 'Choose the Foundry projects in scope'),
  picker('object-type', 'object-type', 'Choose the ontology object types in scope'),
  picker('action-type', 'action-type', 'Choose the ontology action types in scope'),
  blocked('link-type', 'ontology link types', LINK_BEAD),
  blocked('interface', 'ontology interfaces', LINK_BEAD),
  resource('folder', 'folders'),
  resource('dataset', 'datasets'),
  resource('media-set', 'mediaSets'),
  resource('repository', 'repositories'),
  resource('contour', 'contourAnalyses'),
  resource('source', 'sources'),
  resource('developer-console', 'developerConsoles'),
  resource('aip-chatbot', 'aipChatbots'),
  blocked('egress-policy', 'egress policies', LISTING_BEAD),
  blocked('certificate', 'certificates', LISTING_BEAD),
  blocked('automation', 'automations', LISTING_BEAD),
  {
    name: 'media-item',
    description: 'Add a media item by media-set RID and item path or RID',
    argumentHint: '<media-set-rid> <path|rid> | clear',
    action: { type: 'lookup', lookup: 'media-item', kind: 'mediaItems' },
  },
  {
    name: 'objects',
    description: 'Search object instances of the selected object types',
    argumentHint: '<property>=<text> | clear',
    action: { type: 'lookup', lookup: 'objects', kind: 'objectInstances' },
  },
  {
    name: 'function',
    description: 'Search Foundry functions and add them to context',
    argumentHint: '<query> | clear',
    action: { type: 'lookup', lookup: 'function', kind: 'functions' },
  },
  {
    name: 'language-model',
    description: 'Choose the stack language models in context',
    argumentHint: CLEARABLE,
    action: { type: 'lookup', lookup: 'language-model', kind: 'languageModels' },
  },
  {
    name: 'permission',
    description: 'Inspect role grants on a resource and add them to context',
    argumentHint: '<resource-rid> | clear',
    action: { type: 'lookup', lookup: 'permission', kind: 'permissions' },
  },
  {
    name: 'search',
    description: 'Search Foundry resource titles across the stack',
    argumentHint: '<text> | clear',
    action: { type: 'lookup', lookup: 'search', kind: 'searchResults' },
  },
  { name: 'scope', description: 'Show the Foundry context; `clear` resets it, `ontology` re-picks it', argumentHint: '[show | clear | ontology]', action: { type: 'scope' } },
  { name: 'approval', description: 'Show or set the Foundry approval mode, or show the guard rules', argumentHint: '[mode|rules]', action: { type: 'approval' } },
  {
    name: 'fde',
    description: 'FDE mode: bind this session to one agent branch for a goal; writes plan before they apply',
    argumentHint: '<goal> | --branch <rid> <goal> | resume | end',
    action: { type: 'fde' },
  },
  { name: 'trace', description: 'Show trace export status (Langfuse/OTLP) and check the last Foundry trace landed', action: { type: 'trace' } },
  { name: 'mcp-status', description: 'Show Orthanc and Foundry stack status', action: { type: 'mcp-status' } },
]

export const blockedText = (what: string, bead: string) =>
  `Orthanc cannot list ${what} yet, so this command is waiting on bead ${bead} ` +
  `in the orthanc tracker. It does not fall back to Foundry REST.`

// ---------- scope ----------

const asString = (value: unknown) => (typeof value === 'string' ? value : '')

const named = (value: unknown): FoundryNamed | null =>
  isRecord(value) && typeof value.rid === 'string' ? { rid: value.rid, name: asString(value.name) || value.rid } : null

const types = (value: unknown): FoundryObjectType[] =>
  Array.isArray(value)
    ? value.filter(isRecord).flatMap(entry =>
        typeof entry.apiName === 'string'
          ? [{ apiName: entry.apiName, displayName: asString(entry.displayName) || entry.apiName, ...(typeof entry.rid === 'string' ? { rid: entry.rid } : {}) }]
          : [],
      )
    : []

const resourcesOf = (value: unknown): FoundryResource[] =>
  Array.isArray(value)
    ? value.filter(isRecord).flatMap(entry =>
        typeof entry.rid === 'string' ? [{ rid: entry.rid, name: asString(entry.name) || entry.rid, hint: asString(entry.hint) }] : [],
      )
    : []

export const emptyScope = (profile: string, host: string): FoundryScope => ({
  profile,
  host,
  ontology: null,
  projects: [],
  objectTypes: [],
  actionTypes: [],
  resources: {},
  updatedAt: new Date().toISOString(),
})

/** Any stored value (v0.1 scopes included) as a whole FoundryScope. */
export function normalizeScope(value: unknown, profile: string, host: string): FoundryScope {
  if (!isRecord(value)) return emptyScope(profile, host)
  const resources: FoundryScope['resources'] = {}
  if (isRecord(value.resources)) {
    for (const kind of Object.keys(RESOURCE_LABELS) as FoundryResourceKind[]) {
      const list = resourcesOf(value.resources[kind])
      if (list.length > 0) resources[kind] = list
    }
  }
  return {
    profile: asString(value.profile) || profile,
    host: asString(value.host) || host,
    ontology: named(value.ontology),
    projects: Array.isArray(value.projects) ? value.projects.map(named).filter((entry): entry is FoundryNamed => entry !== null) : [],
    objectTypes: types(value.objectTypes),
    actionTypes: types(value.actionTypes),
    resources,
    updatedAt: asString(value.updatedAt) || new Date().toISOString(),
  }
}

export function ontologyChanged(scope: FoundryScope, ontology: FoundryNamed | null): FoundryScope {
  const resources = { ...scope.resources }
  for (const kind of ONTOLOGY_KINDS) resources[kind] = []
  return { ...scope, ontology, projects: [], objectTypes: [], actionTypes: [], resources }
}

// ---------- orthanc rows ----------

export function resourceArgs(query: string, typeId: string, root: string): string[] {
  const trimmed = query.trim()
  return [...(trimmed ? ['resource', 'search', trimmed] : ['resource', 'list']), '--type', typeId, '--folder-rid', root]
}

/** orthanc rows as resources: RID required, first RID wins. */
export function resourceRows(rows: readonly Record<string, unknown>[], hintKeys: readonly string[] = ['path', 'type']): FoundryResource[] {
  const seen = new Set<string>()
  return rows.flatMap(row => {
    const rid = asString(row.rid) || asString(row.__rid) || asString(row.api_name) || asString(row.apiName)
    if (!rid || seen.has(rid)) return []
    seen.add(rid)
    const name =
      asString(row.display_name) || asString(row.displayName) || asString(row.name) || asString(row.__title) || asString(row.api_name) || rid
    const hint = hintKeys.map(key => row[key]).map(value => (isRecord(value) ? asString(value.name) : asString(value))).find(Boolean) ?? ''
    return [{ rid, name, hint }]
  })
}

/** The new selection, plus earlier selections the listing did not show. */
export function mergeSelections(
  existing: readonly FoundryResource[],
  selected: readonly FoundryResource[],
  visible: readonly FoundryResource[],
): FoundryResource[] {
  const shown = new Set(visible.map(entry => entry.rid))
  return [...existing.filter(entry => !shown.has(entry.rid)), ...selected]
}

export function objectsQuery(args: string): { property: string; text: string } | null {
  const match = /^\s*([A-Za-z_][\w.]*)\s*=\s*(.+?)\s*$/.exec(args)
  return match?.[1] && match[2] ? { property: match[1], text: match[2] } : null
}

// ---------- prompt block ----------

const list = (entries: readonly FoundryResource[]) => entries.map(entry => `${entry.name} (${entry.rid})`).join(', ')

export function contextLines(scope: FoundryScope): string[] {
  const lines: string[] = []
  if (scope.ontology) lines.push(`Ontology: ${scope.ontology.name} (${scope.ontology.rid}).`)
  if (scope.projects.length > 0) {
    lines.push(`Projects: ${scope.projects.map(project => `${project.name} (${project.rid})`).join(', ')}.`)
    lines.push('Keep project discovery within the selected project subtrees.')
  }
  if (scope.objectTypes.length > 0) {
    lines.push(`Object types: ${scope.objectTypes.map(type => `${type.displayName} (${type.apiName})`).join(', ')}.`)
  }
  if (scope.actionTypes.length > 0) {
    lines.push(`Action types: ${scope.actionTypes.map(type => `${type.displayName} (${type.apiName})`).join(', ')}.`)
  }
  for (const [kind, label] of Object.entries(RESOURCE_LABELS) as [FoundryResourceKind, string][]) {
    const entries = scope.resources[kind] ?? []
    if (entries.length > 0) lines.push(`${label}: ${list(entries)}.`)
  }
  return lines
}

export const hasFocus = (scope: FoundryScope) =>
  scope.ontology !== null || scope.projects.length > 0 || Object.values(scope.resources).some(entries => (entries?.length ?? 0) > 0)

// ---------- /foundry tree ----------

export type ClearTarget =
  | { type: 'ontology' }
  | { type: 'projects' | 'objectTypes' | 'actionTypes' }
  | { type: 'resource'; kind: FoundryResourceKind }
  | { type: 'item'; section: 'projects' | 'objectTypes' | 'actionTypes'; key: string }
  | { type: 'resource-item'; kind: FoundryResourceKind; rid: string }

export type TreeNode = { id: string; label: string; detail: string; count: number; command: string; clear?: ClearTarget; children: TreeNode[] }

const leaf = (id: string, label: string, detail: string, clear: ClearTarget): TreeNode => ({ id, label, detail, count: 0, command: '', clear, children: [] })

const COMMAND_FOR: Record<FoundryResourceKind, string> = {
  folders: '/folder',
  datasets: '/dataset',
  mediaSets: '/media-set',
  mediaItems: '/media-item',
  repositories: '/repository',
  contourAnalyses: '/contour',
  sources: '/source',
  developerConsoles: '/developer-console',
  aipChatbots: '/aip-chatbot',
  objectInstances: '/objects',
  functions: '/function',
  languageModels: '/language-model',
  permissions: '/permission',
  searchResults: '/search',
}

/** The sections that hold something, top-level, in reading order. */
export function foundryTree(scope: FoundryScope): TreeNode[] {
  const nodes: TreeNode[] = []
  if (scope.ontology) {
    nodes.push({ id: 'ontology', label: 'Ontology', detail: scope.ontology.name, count: 1, command: '/ontology', clear: { type: 'ontology' }, children: [] })
  }
  const typed = (id: 'projects' | 'objectTypes' | 'actionTypes', label: string, command: string, entries: { key: string; label: string; detail: string }[]) => {
    if (entries.length === 0) return
    nodes.push({
      id,
      label,
      detail: '',
      count: entries.length,
      command,
      clear: { type: id },
      children: entries.map(entry => leaf(`${id}:${entry.key}`, entry.label, entry.detail, { type: 'item', section: id, key: entry.key })),
    })
  }
  typed('projects', 'Projects', '/project', scope.projects.map(project => ({ key: project.rid, label: project.name, detail: project.rid })))
  typed('objectTypes', 'Object types', '/object-type', scope.objectTypes.map(type => ({ key: type.apiName, label: type.displayName, detail: type.apiName })))
  typed('actionTypes', 'Action types', '/action-type', scope.actionTypes.map(type => ({ key: type.apiName, label: type.displayName, detail: type.apiName })))
  for (const [kind, label] of Object.entries(RESOURCE_LABELS) as [FoundryResourceKind, string][]) {
    const entries = scope.resources[kind] ?? []
    if (entries.length === 0) continue
    nodes.push({
      id: `resource:${kind}`,
      label,
      detail: '',
      count: entries.length,
      command: COMMAND_FOR[kind],
      clear: { type: 'resource', kind },
      children: entries.map(entry => leaf(`${kind}:${entry.rid}`, entry.name, entry.hint || entry.rid, { type: 'resource-item', kind, rid: entry.rid })),
    })
  }
  return nodes
}

export function applyClear(scope: FoundryScope, target: ClearTarget): FoundryScope {
  switch (target.type) {
    case 'ontology':
      return ontologyChanged(scope, null)
    case 'projects':
    case 'objectTypes':
    case 'actionTypes':
      return { ...scope, [target.type]: [] }
    case 'resource':
      return { ...scope, resources: { ...scope.resources, [target.kind]: [] } }
    case 'resource-item':
      return {
        ...scope,
        resources: { ...scope.resources, [target.kind]: (scope.resources[target.kind] ?? []).filter(entry => entry.rid !== target.rid) },
      }
    case 'item':
      if (target.section === 'projects') return { ...scope, projects: scope.projects.filter(entry => entry.rid !== target.key) }
      return { ...scope, [target.section]: scope[target.section].filter(entry => entry.apiName !== target.key) }
  }
}
