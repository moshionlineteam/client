// my simple class for managing json files
const fs = require("fs");

function appendToJSON(file, obj) {
    try {
        let existingData = [];
        const data = fs.readFileSync(file, 'utf8');
        existingData = JSON.parse(data);

        existingData.push(obj);

        fs.writeFileSync(file, JSON.stringify(existingData, null, 2));

        return true;
    } catch (error) {
        return false;
    }
}

function deleteJsonObj(file, obj, val) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);

        const indexToRemove = jsonData.findIndex(item => item[obj] === val);

        if (indexToRemove !== -1) {
            jsonData.splice(indexToRemove, 1);
            fs.writeFileSync(file, JSON.stringify(jsonData, null, 2));
            return true;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
}

function readJSON(file) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);
        return jsonData;
    } catch (error) {
        return false;
    }
}

function findJsonObj(file, obj, val) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);
        const targetObject = jsonData.find(item => item[obj] === val);

        if (targetObject) {
            return targetObject;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
}

function editValue(file, key, newVal) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);

        if (jsonData.hasOwnProperty(key)) {
            jsonData[key] = newVal;
            fs.writeFileSync(file, JSON.stringify(jsonData, null, 2));
            return true;
        } else {
            return false;
        }
    } catch (error) {
        console.error(error);
        return false;
    }
}

function editJSONValue(file, obj, val) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);

        jsonData[obj] = val;
        fs.writeFileSync(file, JSON.stringify(jsonData, null, 2));
        return true;

    } catch (error) {
        return false;
    }
}

function editValue(file, key, val) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);
        const targetObject = jsonData.find(item => item[key] === key);

        if (targetObject) {
            targetObject[obj] = val;
            fs.writeFileSync(file, JSON.stringify(jsonData, null, 2));
            return true;
        } else {
            return false;
        }
    } catch (error) {
        return false;
    }
}

function objMapJSON(file, objKey) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        const jsonData = JSON.parse(data);
        return jsonData.map(obj => obj[objKey]);
    } catch (error) {
        return false;
    }
}

module.exports = {
    editJSONValue,
    editValue,
    findJsonObj,
    readJSON,
    appendToJSON,
    deleteJsonObj,
    objMapJSON
}
