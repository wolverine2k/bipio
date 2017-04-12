/**
 *
 * The Bipio API Server
 *
 * Copyright (c) 2017 InterDigital, Inc. All Rights Reserved
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 *

 */
var bcrypt      = require('bcrypt'),
crypto = require('crypto'),
BipModel = require('./prototype.js').BipModel;

var AccountAuth = Object.create(BipModel);

function strCryptSync(str) {
  return bcrypt.hashSync(str, bcrypt.genSaltSync(10));
}

function strCryptCmpSync(taintedClear, localHash) {
  return bcrypt.compareSync(taintedClear, localHash);
}

function AESCrypt(value) {
  var key, keyVersion,
  iv = crypto.randomBytes(32).toString('hex').substr(0, 16);
  // get latest key
  for (keyVersion in CFG.k) {
    key = CFG.k[keyVersion];
  }

  var cipher = crypto.createCipheriv('aes-256-cbc', key, iv),
  crypted = cipher.update(value, 'ascii', 'base64') + cipher.final('base64');
  cryptEncoded = new Buffer(keyVersion + iv + crypted).toString('base64');

  return cryptEncoded;
}

function AESDecrypt(cryptedStr, autoPadding) {
  var crypted = new Buffer(cryptedStr, 'base64').toString('utf-8');
  var keyVersion = crypted.substr(0, 1),
    iv = crypted.substr(1, 16),
    key = CFG.k[keyVersion],
    cypher = crypted.substr(17);

  var decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);

  if (!autoPadding) {
    autoPadding = false;
  }
  decipher.setAutoPadding(autoPadding);

  var decrypted = (decipher.update(cypher, 'base64', 'ascii') + decipher.final('ascii'));
  return decrypted;
}

function pwHash(pwValue) {
  var crypted;
  // tokens use AES
  if (this.type !== 'login_primary') {
    crypted = AESCrypt(pwValue);
  // or seeded crypt
  } else {
    crypted = strCryptSync(pwValue);
  }
  return crypted;
}

function cryptSave(value) {
  if (value) {
    var crypted = value;

    // passwords get
    if (this.type == 'login_primary' || this.type == 'login_sub') {
      crypted = strCryptSync(value);
      //app.logmessage('Trying to write login primary to account_auth [' + this.id + ']', 'error');
      //throw new Error('Bad Type');
    } else if (this.type !== 'token_invite') {
      crypted = AESCrypt(value);
    }

    return crypted;
  } else {
    return value;
  }
}

function _encStr(s, toUnicode) {
   var json = JSON.stringify(s);
   return toUnicode ? json : json.replace(/[\u007f-\uffff]/g,
      function(c) {
        return '\\u'+('0000'+c.charCodeAt(0).toString(16)).slice(-4);
      }
   );
}

function cryptSaveObj(value) {
  if (value) {
    //var strVal = (new Buffer(JSON.stringify(value), 'utf-8' )).toString('ascii')
    //return cryptSave(JSON.stringify(strVal));
    var strVal = _encStr(value, false)
    return cryptSave(JSON.stringify(strVal));
  } else {
    return value;
  }
}

AccountAuth.id = '';
AccountAuth.username = '';
AccountAuth.owner_id = '';
// enum 'login_primary', 'login_sub', 'token', 'token_invite', 'oauth', 'oauth_app', 'api_token'
AccountAuth.type = '';
AccountAuth.password = '';

AccountAuth.oauth_provider = ''; // pod/provider name, where type = 'oauth'
AccountAuth.oauth_refresh = ''; // AES refresh token, where type = 'oauth'
AccountAuth.oauth_profile = ''; // AES serialized profile, where type = 'oauth'

AccountAuth.entityName = 'account_auth';
AccountAuth.entitySchema = {
  id: {
    type: String,
    index: true,
    renderable: true,
    writable: false
  },
  type: {
    type: String,
    index: true,
    renderable: true,
    writable: false
  },
  password: {
    type: String,
    renderable: false,
    writable: false,
    set : cryptSave
  },
  username: {
    type: String,
    renderable: false,
    writable: false,
    set : cryptSave
  },
  key: {
    type: String,
    renderable: false,
    writable: false,
    set : cryptSave
  },
  owner_id : {
    type: String,
    index: true,
    renderable: true,
    writable: false
  },
  auth_provider: {
    type: String,
    renderable: true,
    writable: false
  },
  oauth_provider: {
    type: String,
    renderable: true,
    writable: false
  },
  oauth_refresh: {
    type: String,
    renderable: true,
    writable: false,
    set : cryptSave
  },
  oauth_token_expire : {
    type : Number,
    renderable : false,
    writable : false,
    set : function(value) {
      if (value) {
        return (new Date()).getTime() + (value * 1000)
      } else {
        return value;
      }
    }
  },
  oauth_profile: {
    type: Object,
    renderable: true,
    writable: false,
    set : cryptSaveObj
  }
};

AccountAuth.hash = function(value) {
  return pwHash(value);
}

AccountAuth.cmpPassword = function(passwordTainted) {
  var password = this.getPassword().replace(/^\s+|\s+$/g, "");

  // compare hash
  /* disabled
    if (this.type == 'login_primary') {
        return bcrypt.compareSync(passwordTainted, password);
    */
  // AES
  if (this.type == 'token') {
    return passwordTainted == password;
  }
  return false;
};

// gets the password, if it's async then try to decrypt
AccountAuth.getPassword = function() {
  // AES
  if (this.type == 'token') {
    return AESDecrypt(this.password).substr(0,32);
  } else {
    // return this.password;
    if (this.password) {
      return AESDecrypt(this.password, true);
    } else {
      return this.password;
    }
  }
};

AccountAuth.getUsername = function() {
  if (this.username) {
    return AESDecrypt(this.username, true);
  } else {
    return;
  }
};

AccountAuth.getKey = function() {
  if (this.key) {
    return AESDecrypt(this.key, true);
  } else {
    return;
  }
};

AccountAuth.getOAuthRefresh = function() {
  if (this.oauth_refresh) {
    return AESDecrypt(this.oauth_refresh, true);
  } else {
    return null;
  }
}

// gets oauth profile, handles legacy (json string)
// and new object translation
AccountAuth.getOauthProfile = function() {
  var profile = AESDecrypt(this.oauth_profile, true);
  if (app.helper.isObject(profile)) {
    return profile;
  } else {
    try {
      return JSON.parse(profile);
    } catch (e) {
      return 'Profile Not Available';
    }
  }
}

module.exports.AccountAuth = AccountAuth;