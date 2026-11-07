import { Job } from './jobs.js';

interface BaseSheet {
    /** The version of ironworks-cli's output for this sheet that the row was written with (see its `AGENTS.md`). */
    schemaVersion: number;
}

export interface Status extends BaseSheet {
    name: string;
    description: string;
    icon: number;
    maxStacks: number;
    statusCategory: number;
    hitEffect: number;
    transfiguration: number;
    isGaze: boolean;
    canDispel: boolean;
    inflictedByActor: boolean;
    isPermanent: boolean;
}

export interface Action extends BaseSheet {
    name: string;
    icon: number;
    actionCategory: number;
    classJob: number;
    classJobCategory: number;
    behaviourType: number;
    classJobLevel: number;
    isRoleAction: boolean;
    range: number;
    canTargetSelf: boolean;
    canTargetParty: boolean;
    canTargetFriendly: boolean;
    canTargetHostile: boolean;
    targetArea: boolean;
    canTargetDead: boolean;
    castType: number;
    effectRange: number;
    actionCombo: number;
    preservesCombo: number;
    cast100ms: number;
    recast100ms: number;
    cooldownGroup: number;
    maxCharges: number;
    attackType: number;
    aspect: number;
    isPlayerAction: boolean;
    description?: string;
    actionTimelineHit: number;
    animationStart: number;
    animationEnd: number;
    /** The `ActionTimeline` key of {@link animationEnd}, if it has one. */
    animationEndKey?: string;
    /** The length of the animation of {@link animationEnd} in frames (30 per second), if its timeline file was found. */
    animationEndDuration?: number;
    extraCastTime100ms: number;
    XAxisModifier: number;
    omenPath?: string;
    omenType?: number;
    omenAltPath?: string;
    omenAltType?: number;
}

export interface BNpcBase extends BaseSheet {
    scale: number;
    modelChara: number;
    isOmnidirectional: boolean;
    /** The linked ModelChara's hitbox radius, or 0 if its model skeleton's radius applies. */
    modelCharaRadius: number;
    modelCharaModel: number;
    /** The linked ModelChara's model type: 1 human, 2 demihuman, 3 monster. */
    modelCharaType: number;
}

export interface ModelSkeleton extends BaseSheet {
    radius: number;
    height: number;
    VFXScale: number;
}

export interface ContentFinderCondition extends BaseSheet {
    name: string;
    nameShort: string;
    shortCode: string;
    territoryType: number;
    classJobLevelRequired: number;
    classJobLevelSync: number;
    itemLevelRequired: number;
    itemLevelSync: number;
    allowUndersized: boolean;
    allowExplorerMode: boolean;
    highEndDuty: boolean;
    contentType: number;
    image: number;
    icon: number;
}

export type ClassJobCategory = { schemaVersion: number, name: string } & Record<Job, boolean>;

export interface ClassJob extends BaseSheet {
    name: string;
    abbreviation: string;
    classJobCategory: number;
    startingLevel: number;
    partyBonus: number;
    jobType: number;
    isLimitedJob: boolean;
    canQueueForDuty: boolean;
    modifierHitPoints: number;
    modifierManaPoints: number;
    modifierStrength: number;
    modifierVitality: number;
    modifierDexterity: number;
    modifierIntelligence: number;
    modifierMind: number;
    modifierPiety: number;
    classJobParent: number;
    primaryStat: number;
    limitBreak1: number;
    limitBreak2: number;
    limitBreak3: number;
}
