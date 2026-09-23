import { describe, expect, it } from "vitest"
import { env, runInDurableObject } from "cloudflare:test"
import { SpaceDO } from "../src/space/durable-object"
import { readBlobBytes, walkTreeFiles } from "../src/space/git-objects"
import type { Env } from "../src/env"
import type {} from "./test-env"

const paths = ["/index.html", "/a-only.txt", "/b-only.txt"] as const
type Tree = Record<(typeof paths)[number], string | null>

async function committedTree(
  space: SpaceDO,
  commitOid: string,
  selectedPaths: readonly string[] = paths,
): Promise<Record<string, string | null>> {
  const fs = (space as any).backend.fs
  const entries = await walkTreeFiles(fs, commitOid)
  const tree: Record<string, string | null> = {}
  for (const path of selectedPaths) {
    const entry = entries.get(path)
    tree[path] = entry
      ? new TextDecoder().decode(await readBlobBytes(fs, entry.oid))
      : null
  }
  return tree
}

async function commit(space: SpaceDO, message: string) {
  await space.gitCommit(message)
  return (await space.gitLog(1))[0].oid
}

describe("normal SpaceDO forward restore of changed and added/deleted files", () => {
  it("proves checkout does retrieve the changed target file", async () => {
    const stub = env.FsHarnessDO.get(env.FsHarnessDO.idFromName("restore-checkout-contract"))
    await runInDurableObject(stub, async (_instance, state) => {
      const space = new SpaceDO(state, {} as Env)
      await space.writeFile("/index.html", "RESTORE_REAL_A")
      await space.writeFile("/a-only.txt", "A_ONLY")
      const commitA = await commit(space, "A")
      await space.writeFile("/index.html", "RESTORE_REAL_B")
      await space.deleteFile("/a-only.txt")
      await space.writeFile("/b-only.txt", "B_ONLY")
      await (space as any).backend.git.add({ filepath: "index.html" })
      const commitB = await commit(space, "B")
      expect((await committedTree(space, commitB))["/index.html"]).toBe("RESTORE_REAL_B")
      expect((await committedTree(space, commitA))["/index.html"]).toBe("RESTORE_REAL_A")

      await (space as any).backend.git.checkout({ ref: commitA })
      expect(await space.readFile("/index.html")).toBe("RESTORE_REAL_A")
      expect(await space.readFile("/a-only.txt")).toBe("A_ONLY")
      await expect(space.readFile("/b-only.txt")).rejects.toThrow()
    })
  })

  it("commits the exact earlier tree, not a mix of A and B", async () => {
    const stub = env.FsHarnessDO.get(env.FsHarnessDO.idFromName("restore-exact-a-b"))
    await runInDurableObject(stub, async (_instance, state) => {
      const space = new SpaceDO(state, {} as Env)
      const A: Tree = {
        "/index.html": "RESTORE_REAL_A",
        "/a-only.txt": "A_ONLY",
        "/b-only.txt": null,
      }
      const B: Tree = {
        "/index.html": "RESTORE_REAL_B",
        "/a-only.txt": null,
        "/b-only.txt": "B_ONLY",
      }

      await space.writeFile("/index.html", A["/index.html"]!)
      await space.writeFile("/a-only.txt", A["/a-only.txt"]!)
      const commitA = await commit(space, "A")
      expect(await committedTree(space, commitA)).toEqual(A)

      await space.writeFile("/index.html", B["/index.html"]!)
      await space.deleteFile("/a-only.txt")
      await space.writeFile("/b-only.txt", B["/b-only.txt"]!)
      expect(await space.readFile("/index.html")).toBe(B["/index.html"])
      // The normal commit tool stages the worktree. Explicitly stage the
      // overwritten path here so this fixture starts with a verified B commit.
      await (space as any).backend.git.add({ filepath: "index.html" })
      const commitB = await commit(space, "B")
      expect(commitB).not.toBe(commitA)
      expect(await committedTree(space, commitB)).toEqual(B)

      let beforeRestoreCommit: string | undefined
      const realCommit = space.gitCommitLocal.bind(space)
      ;(space as any).gitCommitLocal = async (message: string) => {
        beforeRestoreCommit = await space.readFile("/index.html")
        return realCommit(message)
      }
      // The deployment runs after the forward commit. It does not determine
      // whether SpaceDO's authoritative committed tree matches the target.
      ;(space as any).deploy = async () => ({ error: "test deploy unavailable" })
      await space.rollbackToCommit("main", commitA)
      expect(beforeRestoreCommit).toBe(A["/index.html"])
      const forward = (await space.gitLog(1))[0].oid
      expect(forward).not.toBe(commitB)
      expect(await committedTree(space, forward)).toEqual(A)
      expect(await space.readFile("/index.html")).toBe(A["/index.html"])
      expect(await space.readFile("/a-only.txt")).toBe(A["/a-only.txt"])
      await expect(space.readFile("/b-only.txt")).rejects.toThrow()
    })
  })

  const matrix: Array<{
    name: string
    A: Record<string, string>
    B: Record<string, string>
  }> = [
    {
      name: "changed existing file",
      A: { "/index.html": "RESTORE_REAL_A" },
      B: { "/index.html": "RESTORE_REAL_B" },
    },
    {
      name: "new B-only file is removed",
      A: { "/index.html": "SAME" },
      B: { "/index.html": "SAME", "/b-only.txt": "B_ONLY" },
    },
    {
      name: "deleted A-only file is recreated",
      A: { "/index.html": "SAME", "/a-only.txt": "A_ONLY" },
      B: { "/index.html": "SAME" },
    },
    {
      name: "multiple changed existing files",
      A: { "/index.html": "RESTORE_REAL_A", "/second.txt": "second-A" },
      B: { "/index.html": "RESTORE_REAL_B", "/second.txt": "second-B" },
    },
    {
      name: "changed file in a nested path",
      A: { "/index.html": "SAME", "/nested/page.txt": "nested-A" },
      B: { "/index.html": "SAME", "/nested/page.txt": "nested-B" },
    },
  ]

  for (const [index, { name, A, B }] of matrix.entries()) {
    it(`restores ${name} in the committed tree`, async () => {
      const stub = env.FsHarnessDO.get(env.FsHarnessDO.idFromName(`restore-matrix-${index}`))
      await runInDurableObject(stub, async (_instance, state) => {
        const space = new SpaceDO(state, {} as Env)
        const allPaths = [...new Set([...Object.keys(A), ...Object.keys(B)])]
        async function setFile(path: string, value: string) {
          const parent = path.slice(0, path.lastIndexOf("/"))
          if (parent) await space.mkdir(parent, { recursive: true })
          await space.writeFile(path, value)
        }
        for (const [path, value] of Object.entries(A)) await setFile(path, value)
        const aOid = await commit(space, "A")
        for (const path of Object.keys(A)) {
          if (!(path in B)) await space.deleteFile(path)
        }
        for (const [path, value] of Object.entries(B)) {
          if (A[path] === value) continue
          await setFile(path, value)
          // Guarantee the fixture actually commits the changed blob, even
          // when statusMatrix treats a same-size rapid rewrite as unchanged.
          await (space as any).backend.git.add({ filepath: path.slice(1) })
        }
        const bOid = await commit(space, "B")
        expect(bOid).not.toBe(aOid)
        const expectedA = Object.fromEntries(allPaths.map((p) => [p, A[p] ?? null]))
        const expectedB = Object.fromEntries(allPaths.map((p) => [p, B[p] ?? null]))
        expect(await committedTree(space, aOid, allPaths)).toEqual(expectedA)
        expect(await committedTree(space, bOid, allPaths)).toEqual(expectedB)

        ;(space as any).deploy = async () => ({ error: "test deploy unavailable" })
        await space.rollbackToCommit("main", aOid)
        const restored = (await space.gitLog(1))[0].oid
        expect(await committedTree(space, restored, allPaths)).toEqual(expectedA)
        for (const path of allPaths) {
          if (A[path] === undefined) {
            await expect(space.readFile(path)).rejects.toThrow()
          } else {
            expect(await space.readFile(path)).toBe(A[path])
          }
        }
      })
    })
  }

  for (const failure of ["target", "write", "commit", "tree"] as const) {
    it(`does not deploy after a ${failure} restore failure`, async () => {
      const stub = env.FsHarnessDO.get(env.FsHarnessDO.idFromName(`restore-failure-${failure}`))
      await runInDurableObject(stub, async (_instance, state) => {
        const space = new SpaceDO(state, {} as Env)
        await space.writeFile("/index.html", "RESTORE_REAL_A")
        const aOid = await commit(space, "A")
        await space.writeFile("/index.html", "RESTORE_REAL_B")
        await (space as any).backend.git.add({ filepath: "index.html" })
        const bOid = await commit(space, "B")
        expect((await committedTree(space, bOid))["/index.html"]).toBe("RESTORE_REAL_B")

        let deployed = false
        ;(space as any).deploy = async () => { deployed = true; return { ok: true } }
        if (failure === "write") {
          const fs = (space as any).backend.fs
          fs.writeFileBytes = async () => { throw new Error("injected write failure") }
        }
        if (failure === "commit") {
          ;(space as any).gitCommitLocal = async () => { throw new Error("injected commit failure") }
        }
        if (failure === "tree") {
          // Simulate a commit operation that returns without recording A. The
          // post-commit tree check must reject it instead of deploying B.
          ;(space as any).gitCommitLocal = async () => ({ sha: bOid, message: "not restored" })
        }

        const requested = failure === "target" ? "no-such-commit" : aOid
        if (failure === "target") {
          await expect(space.rollbackToCommit("main", requested)).resolves.toHaveProperty("error")
        } else {
          await expect(space.rollbackToCommit("main", requested)).rejects.toThrow()
        }
        expect(deployed).toBe(false)
      })
    })
  }
})