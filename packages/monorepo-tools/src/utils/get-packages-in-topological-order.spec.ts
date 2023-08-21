import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import os from 'os';
import { getPackagesInTopologicalOrder } from './get-packages-in-topological-order';
import assert from 'assert';

const execFile = promisify(execFileCb);

describe('getPackagesInTopologicalOrder', function () {
  let tempDir: string;
  let remoteDir;
  let repoPath: string;

  const writeRepoFile = async (filePath: string, content: any) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      path.join(repoPath, filePath),
      typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    );
  };

  beforeEach(async function () {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'monorepo-tests-'));

    // create fake git remote:
    remoteDir = path.resolve(tempDir, 'remote');
    await fs.mkdir(remoteDir, { recursive: true });
    process.chdir(remoteDir);
    await execFile('git', ['init', '--bare']);
    await execFile('git', ['config', '--local', 'user.name', 'user']);
    await execFile('git', [
      'config',
      '--local',
      'user.email',
      'user@example.com',
    ]);

    // setup repo and package:
    repoPath = path.resolve(tempDir, 'monorepo-test-repo');
    await fs.mkdir(repoPath, { recursive: true });
    process.chdir(repoPath);

    await execFile('npm', ['init', '-y']);

    const packageJsonPath = path.join(repoPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));

    await fs.writeFile(
      packageJsonPath,
      JSON.stringify({ ...packageJson, workspaces: ['packages/*'] }, null, 2)
    );

    await writeRepoFile('packages/pkg1/package.json', {
      name: 'pkg1',
      version: '0.1.0',
      dependencies: {
        pkg2: '0.1.0',
      },
    });

    await writeRepoFile('packages/pkg2/package.json', {
      name: 'pkg2',
      version: '0.1.0',
      dependencies: {
        pkg3: '0.1.0',
      },
      private: true,
    });

    await writeRepoFile('packages/pkg3/package.json', {
      name: 'pkg3',
      version: '0.1.0',
    });

    await execFile('npm', ['install']); // generates package-lock.json
  });

  // eslint-disable-next-line mocha/no-sibling-hooks
  afterEach(async function () {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // windows fails to clean those up sometimes, let's just skip it and move
      // forward with runnning the tests
    }
  });

  it('returns packages toposorted', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath);

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg3', 'pkg2', 'pkg1']
    );
  });

  it('include dependencies', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath, {
      include: ['pkg2'],
      includeDependencies: true,
    });

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg3', 'pkg2']
    );
  });

  it('include dependents', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath, {
      include: ['pkg2'],
      includeDependents: true,
    });

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg2', 'pkg1']
    );
  });

  it('ignore excluded packages', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath, {
      include: ['pkg2'],
      exclude: ['pkg1'],
      includeDependents: true,
    });

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg2']
    );
  });

  it('ignore private packages with excludePrivate', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath, {
      include: ['pkg2'],
      includeDependents: true,
      excludePrivate: true,
    });

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg1']
    );
  });

  it('filter packages with where', async function () {
    const packages = await getPackagesInTopologicalOrder(repoPath, {
      where: 'name === "pkg1"',
    });

    assert.deepStrictEqual(
      packages.map((p) => p.name),
      ['pkg1']
    );
  });

  describe('since', function () {
    beforeEach(async function () {
      await execFile('git', ['init']);
      await execFile('git', ['config', '--local', 'user.name', 'user']);
      await execFile('git', [
        'config',
        '--local',
        'user.email',
        'user@example.com',
      ]);
      await execFile('git', ['checkout', '-b', 'main']);
      await execFile('git', ['remote', 'add', 'origin', remoteDir]);
      await execFile('git', ['add', '.']);
      await execFile('git', ['commit', '-am', 'init']);
      await execFile('git', ['push', '--set-upstream', 'origin', 'main']);
    });
    it('returns empty if nothing changed', async function () {
      const packages = await getPackagesInTopologicalOrder(repoPath, {
        since: 'HEAD',
      });

      assert.deepStrictEqual(
        packages.map((p) => p.name),
        []
      );
    });

    it('returns packages with untracked files', async function () {
      await writeRepoFile('packages/pkg1/index.js', '');

      const packages = await getPackagesInTopologicalOrder(repoPath, {
        since: 'HEAD',
      });

      assert.deepStrictEqual(
        packages.map((p) => p.name),
        ['pkg1']
      );
    });

    it('returns packages with staged files', async function () {
      await writeRepoFile('packages/pkg1/index.js', '');

      await execFile('git', ['add', '.'], { cwd: repoPath });

      const packages = await getPackagesInTopologicalOrder(repoPath, {
        since: 'HEAD',
      });

      assert.deepStrictEqual(
        packages.map((p) => p.name),
        ['pkg1']
      );
    });

    it('returns packages with committed files changed', async function () {
      await writeRepoFile('packages/pkg1/index.js', '');

      await execFile('git', ['add', '.'], { cwd: repoPath });
      await execFile('git', ['commit', '-m', 'add one file'], {
        cwd: repoPath,
      });

      const packages = await getPackagesInTopologicalOrder(repoPath, {
        since: 'HEAD~1',
      });

      assert.deepStrictEqual(
        packages.map((p) => p.name),
        ['pkg1']
      );
    });

    it('returns packages with staged changes', async function () {
      await writeRepoFile('packages/pkg1/index.js', '');

      await execFile('git', ['add', '.'], { cwd: repoPath });
      await execFile('git', ['commit', '-m', 'add one file'], {
        cwd: repoPath,
      });

      assert.deepStrictEqual(
        (
          await getPackagesInTopologicalOrder(repoPath, {
            since: 'HEAD',
          })
        ).map((p) => p.name),
        [] // HEAD should be 'add one file', so no changes
      );

      await writeRepoFile('packages/pkg1/index.js', 'change');

      await execFile('git', ['add', '.'], { cwd: repoPath });

      assert.deepStrictEqual(
        (
          await getPackagesInTopologicalOrder(repoPath, {
            since: 'HEAD',
          })
        ).map((p) => p.name),
        ['pkg1']
      );
    });
  });
});
