const path = require('path');
const Crawler = require('simplecrawler');
const cheerio = require('cheerio');
const striptags = require('striptags');
const he = require('he');
const parseXlsx = require('excel');
const mongodb = require('mongodb').MongoClient;
const assert = require('assert');
const colors = require('colors');

const mongoPort = process.env.MONGO_PORT || '27017';
const mongoHost = process.env.MONGO_HOST || 'mongo';
const mongoDB = process.env.MONGO_DB || 'accese';
const mongoCol = process.env.MONGO_COL || 'webpages';

const filename = process.env.FILENAME || 'providers.xlsx';

const mongoUrl = `mongodb://${mongoHost}:${mongoPort}/${mongoDB}`;

const insertPage = function(db, page, callback) {
  db.collection(mongoCol).insertOne(page, function(err, result) {
    assert.equal(err, null);
    console.log(result.insertedId);
    callback();
  });
};

const providers = [];
let header = [];
let nameIndex = -1;
let groupIndex = -1;
let websiteIndex = -1;

let pointer = 0;
let counter = 0;

function crawlerFunc() {
  const provider = providers[pointer++];
  let url = provider[header[websiteIndex]];
  if (!url || url.length < 4) {
    crawlerFunc();
  } else {
    if (!url.match(/^[a-zA-Z]+:\/\//)) {
      url = 'http://' + url;
    }
    const crawler = new Crawler(url);

    crawler.maxDepth = 2;
    crawler.parseHTMLComments = false;
    crawler.downloadUnsupported = false;

    const conditionID = crawler.addDownloadCondition(function (queueItem, response, callback) {
      callback(null, queueItem.stateData.contentType.indexOf('text/html') > -1 );
    });

    crawler.on("fetchcomplete", function(queueItem, data) {
      console.log((`${++counter}. ${queueItem.url}`).yellow);
      const page = data.toString();
      const $ = cheerio.load(page);
      const content = {};
      content.url = queueItem.url;
      content.title = $('meta[name*=title]').attr('content') || $('title').text() || '';
      content.description = $('meta[name*=description]').attr('content') || '';
      content.image = $('meta[name*=image]').attr('content') || '';
      $('head').remove();
      $('body').find('.header, .footer, .Header, .Footer, header, footer, script, style, form,' +
        ' ul[class*=nav], ul[class*=menu], nav').remove();
      content.body = he.decode(striptags($.root().html()).replace(/([\n\r]+|(\s\s+))/g, ' '));
      const next = this.wait();
      mongodb.connect(mongoUrl, function(err, db) {
        assert.equal(null, err);
        insertPage(db, content, function() {
          db.close();
          next();
        });
      });
    });

    crawler.on("complete", function() {
      if (pointer < 2) {
        crawlerFunc();
      } else {
        console.log('Finished!'.green);
      }
    });

    crawler.start();
  }
}

function execute() {
  console.log('Parsing Excel File...'.cyan);
  parseXlsx(path.join(__dirname, filename), function(err, data) {
    if (err) {
      throw err;
    }
    header = data[1];
    nameIndex = data[1].indexOf('Registered_Provider_Name');
    groupIndex = data[1].indexOf('Registration_Group');
    websiteIndex = data[1].indexOf('Website');
    for (let i = 2; i < data.length; i++) {
      const rawData = data[i];
      if (!rawData[nameIndex]) {
        providers[providers.length - 1][header[groupIndex]].push(rawData[groupIndex]);
      } else {
        const provider = {};
        for (let j = 0; j < rawData.length - 1; j++) {
          if (j === groupIndex) {
            provider[header[j]] = [rawData[j]];
          } else {
            provider[header[j]] = rawData[j] || '';
          }
        }
        providers.push(provider);
      }
    }

    crawlerFunc();
  });
}

mongodb.connect(mongoUrl, function(err, db) {
  assert.equal(null, err);
  console.log('Cleaning Database...'.cyan);
  db.dropDatabase(function() {
    db.close();
    execute();
  });
});
