import express from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

interface Item {
  fileUrl: string;
}

interface Tree {
  // key: directory name, value: array of subdirectories and file names
  [key: string]: Array<Tree | string>;
}

// function which fetches and transforms the data from the external endpoint
const fetchDataAndTransform = async (): Promise<Tree> => {
  // making an HTTP GET request to the external URL
  const response = await axios.get('https://rest-test-eight.vercel.app/api/test');
  const items: Item[] = response.data.items;
  // transforming the data and returning the Tree structure
  return transformToTree(items);
};

// in-memory cache
let cache: { tree: Tree, timestamp: number } | null = null;
const CACHE_DURATION_MS = 60000; // 1 minute, but should depend on how frequently the data is expected to change

// function which updates the cache with new data
const updateCache = async () => {
  try {
    const newCache = {
      timestamp: Date.now(),
      tree: await fetchDataAndTransform()
    };
    cache = newCache;
    const timestamp = new Date(newCache.timestamp);
    const formattedTimestamp = `${timestamp.getFullYear()}-${(timestamp.getMonth() + 1).toString().padStart(2, '0')}-${timestamp.getDate().toString().padStart(2, '0')} ${timestamp.getHours().toString().padStart(2, '0')}:${timestamp.getMinutes().toString().padStart(2, '0')}:${timestamp.getSeconds().toString().padStart(2, '0')}`;
    console.log(`Cache updated successfully at ${formattedTimestamp}`);
  } catch (err) {
    console.error('Error while updating cache: ', err);
  }
};

// function which transforms the items obtained from the external endpoint into a Tree structure
function transformToTree(items: Item[]): Tree {
  const tree: Tree = {};

  items.forEach(item => {
    const encodedUrl = encodeURI(item.fileUrl); // ensure the URL is properly encoded
    const url = new URL(encodedUrl);
    const isDirectoryUrl = item.fileUrl.endsWith('/');
    const parts = [url.hostname, ...url.pathname.split('/').filter(part => part).map(part => decodeURIComponent(part))]; // combine hostname and decoded pathname parts

    let currentTree: Tree = tree;
    let currentDirName = '';
    parts.forEach((part, index) => {
      if (index === 0) {
        // for the first part (i.e., hostname), initialize root directory if needed
        if (!currentTree[part]) {
          currentTree[part] = [] as Array<Tree | string>;
        }
        currentDirName = part;
      } else if (index < parts.length - 1 || isDirectoryUrl) {
        // otherwise, if not the last part or the last part is also a directory, create Tree for the subdirectory if needed, and "navigate" into it (set currentTree to it) if needed
        let foundDirectory = (currentTree[currentDirName] as Array<Tree | string>).find(entry => typeof entry === 'object' && entry !== null && entry[part]);
        if (!foundDirectory) {
          // initialize the subdirectory Tree if not already created, add it to the current directory elements array
          foundDirectory = { [part]: [] };
          (currentTree[currentDirName] as Array<Tree | string>).push(foundDirectory);
        }
        if (index < parts.length - 1) {
          // if not the last part, "navigate" into subdirectory
          currentTree = foundDirectory as Tree;
          currentDirName = part;
        }
      } else { // index === parts.length - 1 && !isDirectoryUrl
        // add the last part as a file name to the current directory elements array
        let foundFile = (currentTree[currentDirName] as Array<Tree | string>).find(entry => entry !== null && typeof entry === 'string' && entry === part);
        if (!foundFile) { // this is likely always satisfied, but just in case
          (currentTree[currentDirName] as Array<string | Tree>).push(part);
        }
      }
    });

  });

  return tree;
}

const app = express();
const port = 3000;

// defining the GET endpoint
app.get('/api/files', async (req, res) => {
  // serving result from cache if available and not expired
  if (cache && (Date.now() - cache.timestamp) < CACHE_DURATION_MS) {
    console.log('Serving from cache');
    res.setHeader('Content-Type', 'application/json');
    return res.send(JSON.stringify(cache.tree, null, '\t'));
  }
  
  // otherwise, fetching new data
  try {
    console.log('Fetching new data');
    const data = await fetchDataAndTransform();
    cache = {
      timestamp: Date.now(),
      tree: data
    };
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(data, null, '\t'));
  } catch (err) {
    console.log('Error while fetching new data');
    const error = err as any;
    if (error.response) {
      if (error.response.status === 504) {
        res.status(504).json({ error: 'Gateway Timeout' });
      } else if (error.response.status === 502) {
        res.status(502).json({ error: 'Bad Gateway' });
      } else {
        res.status(500).json({ error: 'Failed to fetch data' });
      }
    } else if (error.request) {
      res.status(502).json({ error: 'Bad Gateway' });
    } else {
      res.status(500).json({ error: 'Failed to fetch data' });
    }
  }
});

// starting the server and listening on the specified port, while regularly updating cache
(async () => {
  app.listen(port, async () => {
    console.log(`Server is running on http://localhost:${port}`);
    await updateCache(); // initial cache update
    setInterval(updateCache, CACHE_DURATION_MS); // regularly update cache
  });
})();
