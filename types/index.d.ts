export type FoundryNamed = { rid: string; name: string }

export type FoundryObjectType = { apiName: string; displayName: string; rid?: string }

/** The scope keys that hold selected Foundry resources, as pi-palantir names them. */
export type FoundryResourceKind =
  | 'folders'
  | 'datasets'
  | 'mediaSets'
  | 'mediaItems'
  | 'repositories'
  | 'contourAnalyses'
  | 'sources'
  | 'developerConsoles'
  | 'aipChatbots'
  | 'objectInstances'
  | 'functions'
  | 'languageModels'
  | 'permissions'
  | 'searchResults'

/** One selected resource: its RID (or key), display name and a path or type hint. */
export type FoundryResource = { rid: string; name: string; hint: string }

export type FoundryScope = {
  profile: string
  host: string
  ontology: FoundryNamed | null
  projects: FoundryNamed[]
  objectTypes: FoundryObjectType[]
  actionTypes: FoundryObjectType[]
  resources: Partial<Record<FoundryResourceKind, FoundryResource[]>>
  updatedAt: string
}

export type FoundryPickItem = { key: string; label: string; hint: string }

export type FoundryPickerKind = 'profile' | 'ontology' | 'project' | 'object-type' | 'action-type' | 'resource'

export type FoundryPicker = {
  kind: FoundryPickerKind
  /** The scope key a 'resource' picker writes. */
  resourceKind?: FoundryResourceKind
  title: string
  isMulti: boolean
  items: FoundryPickItem[]
  chosen: string[]
  filter: string
  /** Pickers to open after this one, in order (the /open guided flow). */
  chain: FoundryPickerKind[]
}

declare module 'claude-code' {
  interface PluginState {
    foundry: {
      scope: FoundryScope
      picker: FoundryPicker | null
      workingBranch: string | null
    }
  }
}
