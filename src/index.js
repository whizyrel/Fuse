/* eslint-disable require-jsdoc */
/* eslint-disable max-len */
const Bitap = require('./bitap');
const deepValue = require('./helpers/deep_value');
const isArray = require('./helpers/is_array');

const {Observable} = require('rxjs');
const {map} = require('rxjs/operators');

class Fuse {
  constructor(list, {
    // Approximately where in the text is the pattern expected to be found?
    location = 0,
    // Determines how close the match must be to the fuzzy location (specified above).
    // An exact letter match which is 'distance' characters away from the fuzzy location
    // would score as a complete mismatch. A distance of '0' requires the match be at
    // the exact location specified, a threshold of '1000' would require a perfect match
    // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
    distance = 100,
    // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
    // (of both letters and location), a threshold of '1.0' would match anything.
    threshold = 0.6,
    // Machine word size
    maxPatternLength = 32,
    // Indicates whether comparisons should be case sensitive.
    caseSensitive = false,
    // Regex used to separate words when searching. Only applicable when `tokenize` is `true`.
    tokenSeparator = / +/g,
    // When true, the algorithm continues searching to the end of the input even if a perfect
    // match is found before the end of the same input.
    findAllMatches = false,
    // Minimum number of characters that must be matched before a result is considered a match
    minMatchCharLength = 1,
    // The name of the identifier property. If specified, the returned result will be a list
    // of the items' dentifiers, otherwise it will be a list of the items.
    id = null,
    // List of properties that will be searched. This also supports nested properties.
    keys = [],
    // Whether to sort the result list, by score
    shouldSort = true,
    // The get function to use when fetching an object's properties.
    // The default will search nested paths *ie foo.bar.baz*
    getFn = deepValue,
    // Default sort function
    sortFn = (a, b) => (a.score - b.score),
    // When true, the search algorithm will search individual words **and** the full string,
    // computing the final score as a function of both. Note that when `tokenize` is `true`,
    // the `threshold`, `distance`, and `location` are inconsequential for individual tokens.
    tokenize = false,
    // When true, the result set will only include records that match all tokens. Will only work
    // if `tokenize` is also true.
    matchAllTokens = false,

    includeMatches = false,
    includeScore = false,

    // Will print to the console. Useful for debugging.
    verbose = false,
  }) {
    this.options = {
      location,
      distance,
      threshold,
      maxPatternLength,
      isCaseSensitive: caseSensitive,
      tokenSeparator,
      findAllMatches,
      minMatchCharLength,
      id,
      keys,
      includeMatches,
      includeScore,
      shouldSort,
      getFn,
      sortFn,
      verbose,
      tokenize,
      matchAllTokens,
    };

    this.setCollection(list);
  }

  setCollection(list) {
    this.list = list;
    return list;
  }

  search(pattern, opts = {limit: false}) {
    this._log(`---------\nSearch pattern: "${pattern}"`);

    const {
      tokenSearchers,
      fullSearcher,
    } = this._prepareSearchers(pattern);

    // possible observable return point
    // let {weights, results} = this._search(tokenSearchers, fullSearcher);
    return this._search(tokenSearchers, fullSearcher)
        .pipe(
            map((data) => this._computeScore(data.weights, data.results)),
            map((data) => this._format(data))
        );

    // pipe this
    // this._computeScore(weights, results);

    // another pipe
    // there's no need to sort one item
    // if (this.options.shouldSort) {
    //   this._sort(results);
    // }

    // another pipe
    // a result cannot be sliced
    // if (opts.limit && typeof opts.limit === 'number') {
    //   results = results.slice(0, opts.limit);
    // }

    // another pipe
    // return this._format(results);
  }

  _prepareSearchers(pattern = '') {
    const tokenSearchers = [];

    if (this.options.tokenize) {
      // Tokenize on the separator
      const tokens = pattern.split(this.options.tokenSeparator);
      for (let i = 0, len = tokens.length; i < len; i += 1) {
        tokenSearchers.push(new Bitap(tokens[i], this.options));
      }
    }

    const fullSearcher = new Bitap(pattern, this.options);

    return {tokenSearchers, fullSearcher};
  }

  _search(tokenSearchers = [], fullSearcher) {
    let data;
    let values;
    const list = this.list;
    const resultMap = {};
    const results = []; // wont be an array no more

    // Check the first item in the list, if it's a string, then we assume
    // that every item in the list is also a string, and thus it's a flattened array.
    return new Observable((obs) => {
      if (typeof list[0] === 'string') {
        // Iterate over every item
        for (let i = 0, len = list.length; i < len; i += 1) {
          data = this._analyze({
            key: '',
            value: list[i],
            record: i,
            index: i,
          }, {
            resultMap,
            results,
            tokenSearchers,
            fullSearcher,
          });
        }

        // case 1
        // return {weights: null, results};
        values = Object.values(data);

        for (let i = 0, len = values.length; i < len; i++) {
          obs.next({weights: null, results: values[i]});

          if ((i + 1) === len) {
            obs.complete();
          }
        }

        return;
      }


      // Otherwise, the first item is an Object (hopefully), and thus the searching
      // is done on the values of the keys of each item.
      const weights = {};
      for (let i = 0, len = list.length; i < len; i += 1) {
        const item = list[i];

        // Iterate over every key
        for (let j = 0, keysLen = this.options.keys.length; j < keysLen; j += 1) {
          let key = this.options.keys[j];

          // weights block
          if (typeof key !== 'string') {
            weights[key.name] = {
              weight: (1 - key.weight) || 1,
            };

            if (key.weight <= 0 || key.weight > 1) {
              throw new Error('Key weight has to be > 0 and <= 1');
            }

            key = key.name;
          } else {
            weights[key] = {
              weight: 1,
            };
          }

          data = this._analyze({
            key,
            value: this.options.getFn(item, key),
            record: item,
            index: i,
          }, {
            resultMap,
            results,
            tokenSearchers,
            fullSearcher,
          });
        }
      }

      // case 2
      values = Object.values(data);

      for (let i = 0, len = values.length; i < len; i++) {
        obs.next({weights, results: values[i]});

        if ((i + 1) === len) {
          obs.complete();
        }
      }
      // return {weights, results};
      return;
    });
  }

  _analyze({key, arrayIndex = -1, value, record, index}, {tokenSearchers = [], fullSearcher = [], resultMap = {}, results = []}) {
    // Check if the textvalue can be searched
    if (value === undefined || value === null) {
      return;
    }

    let exists = false;
    let averageScore = -1;
    let numTextMatches = 0;

    if (typeof value === 'string') {
      this._log(`\nKey: ${key === '' ? '-' : key}`);

      const mainSearchResult = fullSearcher.search(value);
      this._log(`Full text: "${value}", score: ${mainSearchResult.score}`);

      // tokenize section
      if (this.options.tokenize) {
        const words = value.split(this.options.tokenSeparator);
        const scores = [];

        for (let i = 0; i < tokenSearchers.length; i += 1) {
          const tokenSearcher = tokenSearchers[i];

          this._log(`\nPattern: "${tokenSearcher.pattern}"`);

          const tokenScores = [];
          let hasMatchInText = false;

          for (let j = 0; j < words.length; j += 1) {
            const word = words[j];
            const tokenSearchResult = tokenSearcher.search(word);
            const obj = {};

            // scores
            if (tokenSearchResult.isMatch) {
              obj[word] = tokenSearchResult.score;
              exists = true;
              hasMatchInText = true;
              scores.push(tokenSearchResult.score);
            } else {
              obj[word] = 1;

              if (!this.options.matchAllTokens) {
                scores.push(1);
              }
            }

            this._log(`Token: "${word}", score: ${obj[word]}`);
            tokenScores.push(obj);
          }

          if (hasMatchInText) {
            numTextMatches += 1;
          }
        }

        averageScore = scores[0];
        const scoresLen = scores.length;

        // scores
        for (let i = 1; i < scoresLen; i += 1) {
          averageScore += scores[i];
        }

        averageScore = averageScore / scoresLen;

        this._log('Token score average:', averageScore);
      }

      let finalScore = mainSearchResult.score;

      if (averageScore > -1) {
        finalScore = (finalScore + averageScore) / 2;
      }

      this._log('Score average:', finalScore);

      const checkTextMatches = (this.options.tokenize && this.options.matchAllTokens) ? numTextMatches >= tokenSearchers.length : true;

      this._log(`\nCheck Matches: ${checkTextMatches}`);

      // If a match is found, add the item to <rawResults>, including its score
      if ((exists || mainSearchResult.isMatch) && checkTextMatches) {
        // Check if the item already exists in our results
        const existingResult = resultMap[index];

        if (existingResult) {
          // Use the lowest score
          // existingResult.score, bitapResult.score
          // possible problem
          existingResult.output.push({
            key,
            arrayIndex,
            value,
            score: finalScore,
            matchedIndices: mainSearchResult.matchedIndices,
          });

          console.log('existing result');
        } else {
          // Add it to the raw result list
          resultMap[index] = {
            item: record,
            output: [{
              key,
              arrayIndex,
              value,
              score: finalScore,
              matchedIndices: mainSearchResult.matchedIndices,
            }],
          };

          return resultMap;
          // results push - avoid push; hot point
          // results.push(resultMap[index]);
        }
      }
    } else if (isArray(value)) {
      for (let i = 0, len = value.length; i < len; i += 1) {
        // recursion
        this._analyze({
          key,
          arrayIndex: i,
          value: value[i],
          record,
          index,
        }, {
          resultMap,
          results,
          tokenSearchers,
          fullSearcher,
        });
      }
    }

    return resultMap;
  }

  _computeScore(weights, results) {
    this._log('\n\nComputing score:\n');

    // take away
    // for (let i = 0, len = results.length; i < len; i += 1) {
    const output = results.output;
    // const output = results[i].output;
    const scoreLen = output.length;

    let currScore = 1;
    let bestScore = 1;

    for (let j = 0; j < scoreLen; j += 1) {
      const weight = weights ? weights[output[j].key].weight : 1;
      const score = weight === 1 ? output[j].score : (output[j].score || 0.001);
      const nScore = score * weight;

      if (weight !== 1) {
        bestScore = Math.min(bestScore, nScore);
      } else {
        output[j].nScore = nScore;
        currScore *= nScore;
      }
    }

    results.score = bestScore === 1 ? currScore : bestScore;
    // results[i].score = bestScore === 1 ? currScore : bestScore;

    this._log(results);
    // this._log(results[i]);
    return results;
  }

  _sort(results) {
    this._log('\n\nSorting....');
    results.sort(this.options.sortFn);
  }

  _format(results) {
    // const finalOutput = [];
    let finalOutput;

    if (this.options.verbose) {
      let cache = [];
      this._log('\n\nOutput:\n\n', JSON.stringify(results, function(key, value) {
        if (typeof value === 'object' && value !== null) {
          if (cache.indexOf(value) !== -1) {
            // Circular reference found, discard key
            return;
          }
          // Store value in our collection
          cache.push(value);
        }

        return value;
      }));

      cache = null;
    }

    const transformers = [];

    if (this.options.includeMatches) {
      transformers.push((result, data) => {
        const output = result.output;
        data.matches = [];

        for (let i = 0, len = output.length; i < len; i += 1) {
          const item = output[i];

          if (item.matchedIndices.length === 0) {
            continue;
          }

          const obj = {
            indices: item.matchedIndices,
            value: item.value,
          };

          if (item.key) {
            obj.key = item.key;
          }

          if (item.hasOwnProperty('arrayIndex') && item.arrayIndex > -1) {
            obj.arrayIndex = item.arrayIndex;
          }

          // my favorite part
          data.matches.push(obj);
        }
      });
    }

    if (this.options.includeScore) {
      transformers.push((result, data) => {
        data.score = result.score;
      });
    }

    // another iteration
    // for (let i = 0, len = results.length; i < len; i += 1) {
    const result = results;
    // const result = results[i];

    if (this.options.id) {
      result.item = this.options.getFn(result.item, this.options.id)[0];
    }

    if (!transformers.length) {
      finalOutput = result.item;
      // continue;
      // possible challenge
      return finalOutput;
    }

    const data = {
      item: result.item,
    };

    // possible challenge
    for (let j = 0, len = transformers.length; j < len; j += 1) {
      transformers[j](result, data);
    }

    // finalOutput.push(data);
    finalOutput = data;
    // }

    return finalOutput;
  }

  _log() {
    if (this.options.verbose) {
      console.log(...arguments);
    }
  }
}

module.exports = Fuse;
