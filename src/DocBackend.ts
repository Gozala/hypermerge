import Debug from "debug"
import * as Backend from "automerge/backend"
import { Change, BackDoc } from "automerge/backend"
import { ToBackendRepoMsg, ToFrontendRepoMsg } from "./RepoMsg"
import Queue from "./Queue"
import { RepoBackend } from "./RepoBackend"
import { Feed, Peer } from "./hypercore"

const log = Debug("hypermerge:back")

export class DocBackend {
  docId: string
  actorId?: string
  private repo: RepoBackend
  private back?: BackDoc
  private localChangeQ = new Queue<Change>("backend:localChangeQ")
  private remoteChangesQ = new Queue<Change[]>("backend:remoteChangesQ")
  private wantsActor: boolean = false

  constructor(core: RepoBackend, docId: string, back?: BackDoc) {
    this.repo = core
    this.docId = docId

    if (back) {
      this.back = back
      this.actorId = docId
      this.subscribeToRemoteChanges()
      this.subscribeToLocalChanges()
      this.repo.toFrontend.push({
        type: "ReadyMsg",
        id: this.docId,
        actorId: docId
      })
    }
  }

  applyRemoteChanges = (changes: Change[]): void => {
    this.remoteChangesQ.push(changes)
  }

  applyLocalChange = (change: Change): void => {
    this.localChangeQ.push(change)
  }

  actorIds = (): string[] => {
    return this.repo.actorIds(this)
  }

  release = () => {
    this.repo.releaseManager(this)
  }

  initActor = () => {
    log("initActor")
    if (this.back) {
      // if we're all setup and dont have an actor - request one
      if (!this.actorId) {
        this.actorId = this.repo.initActorFeed(this)
      }
      this.repo.toFrontend.push({
        type: "ActorIdMsg",
        id: this.docId,
        actorId: this.actorId
      })
    } else {
      // remember we want one for when init happens
      this.wantsActor = true
    }
  }

  init = (changes: Change[], actorId?: string) => {
    this.bench("init", () => {
      const [back, patch] = Backend.applyChanges(Backend.init(), changes)
      this.actorId = actorId
      if (this.wantsActor && !actorId) {
        this.actorId = this.repo.initActorFeed(this)
      }
      this.back = back
      this.subscribeToLocalChanges()
      this.subscribeToRemoteChanges()
      this.repo.toFrontend.push({
        type: "ReadyMsg",
        id: this.docId,
        actorId: this.actorId,
        patch
      })
    })
  }

  subscribeToRemoteChanges() {
    this.remoteChangesQ.subscribe(changes => {
      this.bench("applyRemoteChanges", () => {
        const [back, patch] = Backend.applyChanges(this.back!, changes)
        this.back = back
        this.repo.toFrontend.push({ type: "PatchMsg", id: this.docId, patch })
      })
    })
  }

  subscribeToLocalChanges() {
    this.localChangeQ.subscribe(change => {
      this.bench(`applyLocalChange seq=${change.seq}`, () => {
        const [back, patch] = Backend.applyLocalChange(this.back!, change)
        this.back = back
        this.repo.toFrontend.push({ type: "PatchMsg", id: this.docId, patch })
        this.repo.writeChange(this, this.actorId!, change)
      })
    })
  }

  peers(): Peer[] {
    return this.repo.peers(this)
  }

  feeds(): Feed<Uint8Array>[] {
    return this.actorIds().map(actorId => this.repo.feed(actorId))
  }

  broadcast(message: any) {
    this.peers().forEach(peer => this.message(peer, message))
  }

  message(peer: Peer, message: any) {
    peer.send(Buffer.from(JSON.stringify(message)))
  }

  messageMetadata(peer: Peer) {
    this.message(peer, this.metadata())
  }

  broadcastMetadata() {
    this.broadcast(this.actorIds())
  }

  metadata(): string[] {
    return this.actorIds()
  }

  private bench(msg: string, f: () => void): void {
    const start = Date.now()
    f()
    const duration = Date.now() - start
    log(`docId=${this.docId} task=${msg} time=${duration}ms`)
  }
}
