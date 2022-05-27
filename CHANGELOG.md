2022-5-26 0.3.17
====
* Update Util.writeFile (#27)
  * Update Util.writeFile
  Ensure it handles undefined data gracefully
  Set the function to async
  Set function Util.readFileAsync to async

  * Update chrome-remote-interface to v0.31.2
  Attempting to resolve issues for Node v16

  * Default data to empty string for Util.writeFile for writing
  empty pid files to directory
  Add some catches to handle errors from chrome-remote-interface that
  weren't being caught
  Enforce some amount of synchronicity in opening tabs for workers

  * Upgrade ws to 8.5.0

  * Remove catch statements that don't seem to provide value
  and don't stop the uncaught errors from chrome-remote-interface
  It's likely originating from some of the usage of this.cdp

  * Based on logging in the chrome-remote-interface package
  I was able to determine that the Fetch.continueRequest function was throwing an
  uncaught error.
  Handling this error fixes test running for Node v16

* Remove runtime error and actually start tests for race (#26)
  * Remove runtime error and actually start tests for race

  * remove 5s more from cutoff

2021-10-19 0.3.13
====
* fix `store` reference
