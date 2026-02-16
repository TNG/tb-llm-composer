# Creating a new Release

## Create the artifact

- Update versions in [package.json](../package.json) and [manifest.json](../manifest.json)
  (Typically, you just do this on main as long as we don't have another workflow)
- Run `pnpm install` in order to update the package.json version in pnpm-lock.yaml as well
- Create the *.xpi file: `pnpm run ship`

## Test Release Version

Since E2E tests would be tough to do, this will be a manual task for the foreseeable future:

- Install the .xpi file in thunderbird manually
- Check the following things:
  - Summarize a message (including short-cut)
  - Create a response (including short-cut)
  - Reduce the network response time artificially via the dev tools and check whether the cancel request works 
    (including short-cut)

## Publish

- Create a tag in github with the version
- Create a release in github based on the version and the *.xpi file you created and tested
- Add the release to [updates.json](../updates.json)
  (Do this directly on the main branch. There are no advantages doing this via MR)
